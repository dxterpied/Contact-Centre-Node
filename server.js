require('dotenv').load();

const express = require('express');
const http_port = 5000;
var mustacheExpress = require('mustache-express');
var request = require('request');
var twilio = require('twilio');
var bodyParser = require('body-parser');

const taskrouter = require('twilio').jwt.taskrouter;
const util = taskrouter.util;

const TaskRouterCapability = taskrouter.TaskRouterCapability;
const Policy = TaskRouterCapability.Policy;

const app = express();

const accountSid = process.env.TWILIO_ACME_ACCOUNT_SID;
const authToken = process.env.TWILIO_ACME_AUTH_TOKEN;
const workspaceSid = process.env.TWILIO_ACME_WORKSPACE_SID;
const client = require('twilio')(accountSid, authToken);
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const workflow_sid = process.env.TWILIO_ACME_WORKFLOW_SID;
const caller_id = process.env.TWILIO_ACME_CALLERID;
const wrap_up = process.env.TWILIO_ACME_WRAP_UP_ACTIVTY;
const twiml_app = process.env.TWILIO_ACME_TWIML_APP_SID;

const TASKROUTER_BASE_URL = 'https://taskrouter.twilio.com';
const version = 'v1';
const ClientCapability = require('twilio').jwt.ClientCapability;

function buildWorkspacePolicy(options, context) {
  const taskrouter = twilio.jwt.taskrouter;
  const TaskRouterCapability = taskrouter.TaskRouterCapability;
  const Policy = TaskRouterCapability.Policy;
  options = options || {};
  var version = 'v1';
  var resources = options.resources || [];
  const TASKROUTER_BASE_URL = 'https://' + 'taskrouter.twilio.com';
  var urlComponents = [
    TASKROUTER_BASE_URL,
    version,
    'Workspaces',
    workspaceSid
  ];
  return new Policy({
    url: urlComponents.concat(resources).join('/'),
    method: options.method || 'GET',
    allow: true
  });
}

app.use(express.static(__dirname + '/public'));

app.use(bodyParser.json()); // to support JSON-encoded bodies
app.use(
  bodyParser.urlencoded({
    // to support URL-encoded bodies
    extended: true
  })
);
//app.set('view engine', 'liquid');
// Register '.html' extension with The Mustache Express
app.engine('html', mustacheExpress());
//app.set('view engine', 'mustache');

app.set('views', __dirname + '/views'); // you can change '/views' to '/public',
// but I recommend moving your templates to a directory
// with no outside access for security reasons

app.get('/', function(req, res) {
  res.render('index.html');
});

app.post('/incoming_call', function(req, res) {
  const response = new VoiceResponse();

  const gather = response.gather({
    input: 'speech dtmf',
    timeout: 3,
    numDigits: 1,
    action: '/enqueue_call'
  });

  gather.say('please select from the following options');
  gather.say('for sales press one, for support press two');
  gather.say('for billing press three, for marketing press 4');

  res.send(response.toString());
});

app.post('/enqueue_call', function(req, res) {
  const response = new VoiceResponse();
  var Digits = req.body.Digits;

  var product = {
    1: 'sales',
    2: 'support',
    3: 'marketing'
  };

  const enqueue = response.enqueue({ workflowSid: workflow_sid });
  enqueue.task({}, JSON.stringify({ selected_product: product[Digits] }));

  res.type('text/xml');

  res.send(response.toString());
});

app.post('/assignment_callback', function(req, res) {
  dequeue = {
    instruction: 'dequeue',
    from: caller_id,
    post_work_activity_sid: wrap_up
  };
  res.type('application/json');

  res.json(dequeue);
});

app.get('/agent_list', function(req, res) {
  res.render('agent_list.html');
});

app.post('/agent_list', function(req, res) {
  client.taskrouter.v1
    .workspaces(workspaceSid)
    .workers.list({
      TargetWorkersExpression: 'worker.channel.chat.configured_capacity > 0'
    })
    .then(workers => {
      var voice_workers = workers;

      res.setHeader('Content-Type', 'application/json');
      res.send(voice_workers);
    });
});

app.get('/agents', function(req, res) {
  res.render('agent_desktop.html', { caller_id: caller_id });
});

app.post('/callTransfer', function(req, res) {
  const response = new VoiceResponse();

  client
    .conferences(req.body.conference)
    .participants(req.body.participant)
    .update({ hold: true });

  client.taskrouter
    .workspaces(workspaceSid)
    .tasks.create({
      attributes: JSON.stringify({
        selected_product: 'manager',
        conference: req.body.conference,
        customer_taskSid: req.body.taskSid,
        customer: req.body.participant
      }),
      workflowSid: workflow_sid
    })
    .then(res.send(response.toString()))
    .done();
});

app.post('/transferTwiml', function(req, res) {
  const url = require('url');
  const response = new VoiceResponse();
  const dial = response.dial();
  const querystring = url.parse(req.url, true);

  dial.conference(querystring.query.conference);

  res.send(response.toString());
});

app.post('/callMute', function(req, res) {
  client
    .conferences(req.body.conference)
    .participants(req.body.participant)
    .update({ hold: req.body.muted });
});

app.post('/activities', function(req, res) {
  var list = [];

  client.taskrouter.v1
    .workspaces(workspaceSid)
    .activities.list()
    .then(activities => {
      res.setHeader('Content-Type', 'application/json');

      res.send(activities);
    });
});

app.use('/worker_token', function(req, res) {
  let jwt = require('jsonwebtoken');
  //Set access control headers to avoid CORBs issues
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const workerSid = req.body.WorkerSid;
  const taskrouter = twilio.jwt.taskrouter;
  const util = twilio.jwt.taskrouter.util;
  const TaskRouterCapability = taskrouter.TaskRouterCapability;
  const capability = new TaskRouterCapability({
    accountSid: accountSid,
    authToken: authToken,
    workspaceSid: workspaceSid,
    channelId: workerSid,
    ttl: 2880
  });
  // Event Bridge Policies
  var eventBridgePolicies = util.defaultEventBridgePolicies(
    accountSid,
    workerSid
  );

  var workspacePolicies = [
    // Workspace fetch Policy
    buildWorkspacePolicy(),
    // Workspace subresources fetch Policy
    buildWorkspacePolicy({ resources: ['**'] }),
    // Workspace Activities Update Policy
    buildWorkspacePolicy({ resources: ['Activities'], method: 'POST' }),
    buildWorkspacePolicy({ resources: ['Activities'], method: 'GET' }),
    // Workspace Activities Task Policy

    buildWorkspacePolicy({ resources: ['Tasks', '**'], method: 'POST' }),
    buildWorkspacePolicy({ resources: ['Tasks', '**'], method: 'GET' }),

    // Workspace Worker Reservation Policy
    buildWorkspacePolicy({
      resources: ['Workers', workerSid, 'Reservations', '**'],
      method: 'POST'
    }),
    buildWorkspacePolicy({
      resources: ['Workers', workerSid, 'Reservations', '**'],
      method: 'GET'
    }),

    // Workspace Worker Channel Policy

    buildWorkspacePolicy({
      resources: ['Workers', workerSid, 'Channels', '**'],
      method: 'POST'
    }),
    buildWorkspacePolicy({
      resources: ['Workers', workerSid, 'Channels', '**'],
      method: 'GET'
    }),

    // Workspace Worker  Policy

    buildWorkspacePolicy({ resources: ['Workers', workerSid], method: 'GET' }),
    buildWorkspacePolicy({ resources: ['Workers', workerSid], method: 'POST' })
  ];

  eventBridgePolicies.concat(workspacePolicies).forEach(function(policy) {
    capability.addPolicy(policy);
  });

  var token = capability.toJwt();

  res.json(token);
});

app.post('/client_token', function(req, res) {
  const identity = req.body.WorkerSid;

  const capability = new ClientCapability({
    accountSid: accountSid,
    authToken: authToken
  });
  capability.addScope(
    new ClientCapability.OutgoingClientScope({ applicationSid: twiml_app })
  );
  capability.addScope(new ClientCapability.IncomingClientScope(identity));
  const token = capability.toJwt();

  res.set('Content-Type', 'application/jwt');
  res.send(token);
});

app.listen(http_port, () =>
  console.log(`Example app listening on port ${http_port}!`)
);
