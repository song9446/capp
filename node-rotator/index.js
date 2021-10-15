const { Rotator } = require('./lib');

const { 
  TARGET_NODE_SELECTOR, IN_CLUSTER, REPLICAS, NAMESPACE
} = process.env;

if(TARGET_NODE_SELECTOR == undefined) {
  console.error('TARGET_NODE_SELECTOR env var must be set');
  process.exit(2);
}

const nodeSelector = Object.fromEntries([TARGET_NODE_SELECTOR?.split('=')]);
const inCluster = IN_CLUSTER;
const replicas = parseInt(REPLICAS) || undefined;
const namespace = NAMESPACE || 
  require('fs', 'utf8').readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace') || 
  'default';


const r = new Rotator({nodeSelector, inCluster, replicas, namespace});

r.runForever();
