import {Rotator} from './lib';

const {TARGET_NODE_SELECTOR, IN_CLUSTER, REPLICAS, NAMESPACE} = process.env;

if (TARGET_NODE_SELECTOR === undefined) {
  throw Error('TARGET_NODE_SELECTOR env var must be set');
}

const nodeSelector = Object.fromEntries([TARGET_NODE_SELECTOR?.split('=')]);
const inCluster = IN_CLUSTER ? true : false;
const replicas = Number(REPLICAS) || undefined;
const namespace =
  NAMESPACE ||
  (IN_CLUSTER &&
    require('fs')
      .readFileSync(
        '/var/run/secrets/kubernetes.io/serviceaccount/namespace',
        'utf8'
      )
      .trim()) ||
  'default';

const r = new Rotator({nodeSelector, inCluster, replicas, namespace});

r.runForever();
