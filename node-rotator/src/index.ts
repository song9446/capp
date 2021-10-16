import {Rotator} from './lib';

const {
  TARGET_NODE_SELECTOR,
  TARGET_TOLERATIONS,
  IN_CLUSTER,
  REPLICAS,
  NAMESPACE,
  NAME,
} = process.env;

if (TARGET_NODE_SELECTOR === undefined) {
  throw Error('TARGET_NODE_SELECTOR env var must be set');
}

const nodeSelector = Object.fromEntries(
  TARGET_NODE_SELECTOR?.split(',')?.map(s => s.split('=')) || []
);
const tolerations = Object.fromEntries(
  TARGET_TOLERATIONS?.split(',')?.map(s => s.split('=')) || []
);
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
const name = NAME;

const r = new Rotator({
  nodeSelector,
  inCluster,
  replicas,
  namespace,
  name,
  tolerations,
});

r.runForever();
