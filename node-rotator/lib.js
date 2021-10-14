const k8s = require('@kubernetes/client-node');
const { sleep } = require('./util');

class Rotator {
  constructor(options) {
    const { 
      nodeSelector = undefined,
      inCluster = false,
      intervalSeconds = 7200,
      replicas = 1,
      name = 'node-rotator',
      namespace = 'default',
    } = options;
    const kc = new k8s.KubeConfig();
    if(inCluster)
      kc.loadFromCluster();
    else
      kc.loadFromDefault();
    this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    this.nodeSelector = nodeSelector;
    this.intervalSeconds = intervalSeconds;
    this.replicas = replicas;
    this.name = name;
    this.namespace = namespace;
    this.state = 'unknown';
  }
  async getPods() {
    const rPods = await this.k8sApi.listNamespacedPod(this.namespace, undefined, undefined, undefined, undefined, `app=${this.name}`);
    return rPods.body.items;
  }
  async getNodes() {
    const resp = await this.k8sApi.listNode(undefined, undefined, undefined, undefined, Object.entries(this.nodeSelector).map(kv => kv.join('=')).join(','));
    return resp.body.items;
  }
  /*async fillNodes() {
    const nodes = await this.getNodes();
    const pods = await this.getPods();
    while(nodes.length > pods.length) {
    }
  }*/
  async genDummyPod() {
    const name = this.name + '-' + Math.floor(Math.random()*1000000);
    await this.k8sApi.createNamespacedPod(this.namespace, {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name,
        namespace: this.namespace,
        labels: {
          app: this.name,
        }
      },
      spec: {
        topologySpreadConstraints: [{ 
          maxSkew: 1,
          topologyKey: 'kubernetes.io/hostname',
          whenUnsatisfiable: 'DoNotSchedule',
          labelSelector: {
            matchLabels: {
              app: this.name,
            }
          },
        }],
        nodeSelector: this.nodeSelector,
        containers: [{
          name: 'busybox',
          image: 'busybox',
          command: ['/bin/sh', '-ec', 'while :; do sleep 5; done']
        }],
      }
    });
    while(true) {
      await sleep(5000);
      const rPods = await this.k8sApi.readNamespacedPod(name, this.namespace);
      if(rPods.body.status.phase !== 'Running') {
        console.log('wait dummy pod is ready..');
      } else {
        break;
      }
    }
  }
  async drain(name) {
    const rNode = await this.k8sApi.readNode(name);
    const node = rNode.body;
    if(!node.spec.unschedulable) {
      node.spec.unschedulable = true;
      await this.k8sApi.replaceNode(name, node);
    } else {
      console.error('warn: already node codoned');
    }
    const rPods = await this.k8sApi.listPodForAllNamespaces(undefined, undefined, `spec.nodeName=${name}`);
    const pEvictions = rPods.body.items
      .filter(pod => pod.metadata.ownerReferences?.[0]?.kind !== 'DaemonSet')
      .filter(pod => pod.metadata.namespace !== 'kube-system')
      .map(pod => 
        this.k8sApi.createNamespacedPodEviction(
          pod.metadata.name,
          pod.metadata.namespace,
          {
            apiVersion: 'policy/v1beta1',
            kind: 'Eviction',
            metadata: {
              name: pod.metadata.name,
              namespace: pod.metadata.namespace,
            },
          }
        )
      );
    const results = await Promise.all(pEvictions);
  }
  async run() {
    const nodes = await this.getNodes();
    let pods = await this.getPods();

    while(pods.length < this.replicas) {
      console.log(`create dummy pods..`)
      await this.genDummyPod();
      pods = await this.getPods();
    }

    const now = new Date();
    const rottenNodes = nodes
      .filter(node => !node.spec.unschedulable)
      .filter(node => now - node.metadata.creationTimestamp > this.intervalSeconds * 1000);
    if(rottenNodes.length) {
      if(pods.some(pod => pod.status.phase !== 'Running')) {
        console.error('non-running dummy pod is detected(maybe it is scaling up). skip it');
        return false;
      }
      console.log(`create dummy pod to node scaleup..`)
      await this.genDummyPod();
      console.log(`drain ${rottenNodes[0].metadata.name}`);
      const results = await this.drain(rottenNodes[0].metadata.name);
    } else {
      console.log(`theres no rotten nodes. skip it`);
    }
  }
  async runForever() {
    while(true) {
      await this.run();
      console.log(`wait 10 minutes..`);
      await sleep(600*1000);
    }
  }
}

module.exports = {
  Rotator
};
