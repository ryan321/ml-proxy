# ml-proxy
Node proxy code for calling MarkLogic endpoints. Supports using cookies or basic authentication with the MarkLogic REST API.

## Usage
- use `require` to load the module
- call the `init` function to set parameters (authMethod can either be 'cookie' or 'basic'
- call `proxy` object and optionally override:
    - path
    - method
    - params
    - body
    - headers
- optionally provide a response handler callback function
```
var mlProxy = require('ml-proxy');

mlProxy.init({
  mlPort: options.mlPort,
  mlHost: options.mlHost,
  authMethod: 'cookie'
});
var proxy = mlProxy.proxy;

//User log in
app.post('/api/user/login', function(req, res) {
  mlProxy.proxyLogin(req, res, {
    username: req.body.username,
    password: req.body.password
  });
});

//User log out
app.get('/api/user/logout', function(req, res) {
  delete req.session.user;
  mlProxy.proxyLogout(req, res);
});

//Example getting a doc by uri
app.get('/api/get/:uri', function(req, res) {
  var path = '/v1/documents?uri=' + req.params.uri + '&transform=to-json';
  proxy(req, res, {
    path: path
  });
});
