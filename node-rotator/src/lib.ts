import * as k8s from '@kubernetes/client-node';
import {sleep} from './util';

export interface Options {
  nodeSelector?: string;
  inCluster?: boolean;
  intervalSeconds?: number;
  replicas?: number;
  name?: string;
  namespace?: string;
}

export class Rotator {
  k8sApi: k8s.CoreV1Api;
  nodeSelector: Record<string, string>;
  intervalSeconds: number;
  replicas: number;
  name: string;
  namespace: string;
  exit: boolean;
  constructor(options: Options) {
    const {
      nodeSelector = {},
      inCluster = false,
      intervalSeconds = 7200,
      replicas = 1,
      name = 'node-rotator',
      namespace = 'default',
    } = options;
    const kc = new k8s.KubeConfig();
    if (inCluster) kc.loadFromCluster();
    else kc.loadFromDefault();
    this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    this.nodeSelector = nodeSelector;
    this.intervalSeconds = intervalSeconds;
    this.replicas = replicas;
    this.name = name;
    this.namespace = namespace;
    this.exit = false;
  }
  dummyPodName(): string {
    return this.name + '-dummy';
  }
  async getDummyPods() {
    const rPods = await this.k8sApi.listNamespacedPod(
      this.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=${this.dummyPodName()}`
    );
    return rPods.body.items;
  }
  async getTargetNodes() {
    const resp = await this.k8sApi.listNode(
      undefined,
      undefined,
      undefined,
      undefined,
      Object.entries(this.nodeSelector)
        .map(kv => kv.join('='))
        .join(',')
    );
    return resp.body.items;
  }
  async genDummyPod() {
    const name =
      this.dummyPodName() + '-' + Math.floor(Math.random() * 1000000);
    await this.k8sApi.createNamespacedPod(this.namespace, {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name,
        namespace: this.namespace,
        labels: {
          app: this.dummyPodName(),
        },
      },
      spec: {
        /*topologySpreadConstraints: [{
          maxSkew: 1,
          topologyKey: 'kubernetes.io/hostname',
          whenUnsatisfiable: 'DoNotSchedule',
          labelSelector: {
            matchLabels: {
              app: this.dummyPodName(),
            }
          },
        }],*/
        affinity: {
          podAntiAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: [
              {
                labelSelector: {
                  matchExpressions: [
                    {
                      key: 'app',
                      operator: 'In',
                      values: [this.dummyPodName()],
                    },
                  ],
                },
                topologyKey: 'kubernetes.io/hostname',
              },
            ],
          },
        },
        nodeSelector: this.nodeSelector,
        containers: [
          {
            name: 'busybox',
            image: 'busybox',
            command: ['/bin/sh', '-ec', 'while :; do sleep 5; done'],
          },
        ],
      },
    });
    while (!this.exit) {
      await sleep(5000);
      const rPods = await this.k8sApi.readNamespacedPod(name, this.namespace);
      if (rPods.body.status?.phase !== 'Running') {
        console.log('wait dummy pod is ready..');
      } else {
        break;
      }
    }
  }
  async evictPod(name: string, namespace: string) {
    return await this.k8sApi.createNamespacedPodEviction(name, namespace, {
      apiVersion: 'policy/v1beta1',
      kind: 'Eviction',
      metadata: {
        name,
        namespace,
      },
    });
  }
  async drainNode(name: string) {
    const rNode = await this.k8sApi.readNode(name);
    const node = rNode.body;
    if (node.spec === undefined) {
      throw Error('error: node spec is undefined:' + JSON.stringify(node));
    } else if (!node.spec.unschedulable) {
      node.spec.unschedulable = true;
      await this.k8sApi.replaceNode(name, node);
    } else {
      console.error('warn: already node codoned');
    }
    const rPods = await this.k8sApi.listPodForAllNamespaces(
      undefined,
      undefined,
      `spec.nodeName=${name}`
    );
    const pEvictions = rPods.body.items
      .filter(pod => pod.metadata?.name && pod.metadata?.namespace)
      .filter(pod => pod.metadata!.ownerReferences?.[0]?.kind !== 'DaemonSet')
      .filter(pod => pod.metadata!.namespace !== 'kube-system')
      .map(pod => this.evictPod(pod.metadata!.name!, pod.metadata!.namespace!));
    await Promise.all(pEvictions);
  }
  async run() {
    const nodes = await this.getTargetNodes();
    let pods = await this.getDummyPods();

    if (pods.some(pod => pod.status?.phase !== 'Running')) {
      console.error(
        'non-running dummy pod is detected(maybe it is scaling up). skip it'
      );
      return;
    }

    if (pods.length > this.replicas) {
      const pod = pods[0];
      console.error('too many pods are detected. remove one and skip it');
      await this.evictPod(pod.metadata!.name!, pod.metadata!.namespace!);
      return;
    }

    while (pods.length < this.replicas) {
      console.log('create dummy pods..');
      await this.genDummyPod();
      pods = await this.getDummyPods();
    }

    const now = new Date();
    const rottenNodes = nodes
      .filter(node => node.spec && node.metadata?.creationTimestamp)
      .filter(node => !node.spec!.unschedulable)
      .filter(
        node =>
          now.getTime() - node.metadata!.creationTimestamp!.getTime() >
          this.intervalSeconds * 1000
      );
    if (rottenNodes.length) {
      console.log('create dummy pod to node scaleup..');
      await this.genDummyPod();
      console.log(`drainNode ${rottenNodes[0].metadata!.name}`);
      await this.drainNode(rottenNodes[0].metadata!.name!);
    } else {
      console.log('theres no rotten nodes. skip it');
    }
  }
  async runForever() {
    while (!this.exit) {
      await this.run();
      console.log('wait 10 minutes..');
      await sleep(600 * 1000);
    }
  }
}
