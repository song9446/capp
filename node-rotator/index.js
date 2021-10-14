const { Rotator } = require('./lib');

const { 
  NODE_SELECTOR, IN_CLUSTER, REPLICAS, NAMESPACE
} = process.env;

if(NODE_SELECTOR == undefined) {
  console.error('NODE_SELECTOR env var must be set');
  process.exit(2);
}

const nodeSelector = Object.fromEntries([NODE_SELECTOR?.split('=')]);
const inCluster = IN_CLUSTER;
const replicas = parseInt(REPLICAS) || undefined;
const namespace = parseInt(NAMESPACE) || 'default';

const r = new Rotator({nodeSelector, inCluster, replicas, namespace});

r.runForever();
