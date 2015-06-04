var http = require('http');
http.post = require('./lib/http-post.js');
var util = require('util');

function buildMlCookieHeader(mlSessionCookieName, mlSessionId) {
  console.log('buildMlCookieHeader: ' + mlSessionCookieName + '=' + mlSessionId + ';');
  return mlSessionCookieName + '=' + mlSessionId + '; ';
}

function buildBasicAuth(options, session) {
  if (session.user !== undefined && session.user.name !== undefined) {
    return session.user.name + ':' + session.user.password;
  } else {
    return options.defaultUser + ':' + options.defaultPass;
  }
}

var mlProxy = function() {

    var options = {};
    var mlSessionCookieName = 'mlSessionId';
    var debug = false;
    var usingCookies = false;

    var init = function(optionsIn) {
      options = optionsIn;
      mlSessionCookieName = options.mlSessionCookieName ? options.mlSessionCookieName : mlSessionCookieName;
      debug = options.debug ? options.debug : debug;
      usingCookies = options.authMethod === 'cookie';
    };

    var handleMlCookie = function(req, response, proxyOptions) {

      var body = proxyOptions.body ? proxyOptions.body : req.body;

      var cookies = response.headers['set-cookie'];
      console.log('cookie: ' + util.inspect(response.headers['set-cookie']));

      var mlSessionCookie = null;
      if (typeof cookies === 'string') {
        mlSessionCookie = cookies;
      }
      else if (typeof cookies === 'object') {
        for (var mlSessionCookieI = 0; mlSessionCookieI < cookies.length; mlSessionCookieI++) {
          var curCookie = cookies[mlSessionCookieI];
          if (curCookie.indexOf(mlSessionCookieName) > -1) {
            mlSessionCookie = curCookie;
            break;
          }
        }
      }

      console.log('mlSessionCookie: ' + mlSessionCookie);
      var mlSessionId = null;

      try {
        mlSessionId = mlSessionCookie.split(';')[0].split('=')[1];
      }
      catch(err) {}

      console.log('mlSessionId: ' + mlSessionId);

      var username = undefined;
      if (proxyOptions.username) {
        username = proxyOptions.username;
      }
      else if (body['rs:username']) {
        username = body['rs:username'];
      }
      else if (body['username']) {
        username = body['username'];
      }
      console.log('username: ' + username);

      if (mlSessionId) {
        req.session.mlSessionId = mlSessionId;
      }

      if (username) {
        req.session.user = {
          name: username
        };
      }

    };

    var proxy = function(req, res, proxyOptions, callback) {

      proxyOptions          = proxyOptions ? proxyOptions : {};
      var path              = proxyOptions.path ? proxyOptions.path : req.path;
      var params            = proxyOptions.params;
      var addRsToParamNames = proxyOptions.addRsToParamNames ? proxyOptions.addRsToParamNames : false;
      var body              = proxyOptions.body ? proxyOptions.body : req.body;
      var method            = (proxyOptions.method ? proxyOptions.method : req.method).toUpperCase();
      var headers           = req.headers;

      // add rs: to url param names for ml rest api
      if (addRsToParamNames) {
        var paramObj = {};
        for (var key in params) {
          if (params.hasOwnProperty(key)) {
            paramObj['rs:'+key] = params[key];
          }
        }
        params = paramObj;
      }

      // add rs: to body param names for ml rest api
      if (addRsToParamNames) {
        var paramObj = {};
        for (var key in body) {
          if (body.hasOwnProperty(key)) {
            paramObj['rs:'+key] = body[key];
          }
        }
        body = paramObj;
      }

      //The query string
      var queryString = null;
      if (params) {
        var paramArray = [];
        for (var key in params) {
          if (params.hasOwnProperty(key)) {
            paramArray.push(key + '=' + params[key]);
          }
        }
        queryString = '?' + paramArray.join('&');
      }
      else if (req.originalUrl.split('?')[1]) {
        queryString = '?' + req.originalUrl.split('?')[1];
      }
      else {
        queryString = '';
      }
      if (debug) console.log('queryString: ' + queryString);

      //The full path (path + any query params)
      var fullPath = path + queryString;

      console.log(method + ' ' + req.path + ' proxied to ' + options.mlHost + ':' + options.mlPort + fullPath);

      var mlReq = null;


      var defaultResponseHandler = function(response) {

        //console.log('mlReq: ' + util.inspect(mlReq));
        //console.log('response: ' + util.inspect(response));

        if (usingCookies) {
          handleMlCookie(req, response, proxyOptions);
        }

        if (response.headers.location) {
          res.header('location', response.headers.location);
        }

        if (response.statusCode === 200) {
          response.on('data', function(chunk) {
            res.write(chunk);
          });
          response.on('end', function() {
            res.end();
          });
        }
        else {
          res.statusCode = response.statusCode;
          res.send('error');
        }
      };

      //handle different auth methods
      var auth = '';
      if (usingCookies) {
        headers.cookie = buildMlCookieHeader(mlSessionCookieName, req.session.mlSessionId);
      }
      else {
        auth = proxyOptions.auth ? proxyOptions.auth : buildBasicAuth(options, req.session);
      }

      var responseHandler = callback ? callback : defaultResponseHandler;

      if (method === 'POST' || method.toLowerCase() === 'PUT') {
        mlReq = http.post({
          hostname: options.mlHost,
          port: options.mlPort,
          method: method,
          path: fullPath,
          headers: headers,
          auth: auth
        },
        body,
        responseHandler);
      }
      else {
        mlReq = http.request({
          hostname: options.mlHost,
          port: options.mlPort,
          method: method,
          path: fullPath,
          headers: headers,
          auth: auth
        },
        responseHandler);

        if (body !== undefined) {
          mlReq.write(JSON.stringify(body));
          mlReq.end();
        }
      }

      mlReq.on('error', function(e) {
        console.log('Problem with request: ' + e.message);
      });

    };

    var proxyLogin = function(req, res, proxyOptions, callback)  {
      if (usingCookies) return proxyCookieLogin(req, res, proxyOptions, callback);
      else              return proxyBasicLogin(req, res, proxyOptions, callback);
    }

    var proxyBasicLogin = function(req, res, proxyOptions, callback) {

      proxyOptions = proxyOptions ? proxyOptions : {};
      var path     = proxyOptions.path ? proxyOptions.path : '/v1/documents?uri=/users/' + proxyOptions.username + '.json';
      var method   = proxyOptions.method ? proxyOptions.method : 'get';
      var auth     = proxyOptions.username + ':' + proxyOptions.password;

      proxy(req, res, {
        path: path,
        method: method,
        auth: auth
      }, function(response) {
        if (response.statusCode === 401) {
          res.statusCode = 401;
          res.send('Unauthenticated');
        } else if (response.statusCode === 404) {
          // authentication successful, but no profile defined
          req.session.user = {
            name: proxyOptions.username,
            password: proxyOptions.password
          };
          res.send(200, {
            authenticated: true,
            username: proxyOptions.username
          });
        } else {
          if (response.statusCode === 200) {
            // authentication successful, remember the username
            req.session.user = {
              name: proxyOptions.username,
              password: proxyOptions.password
            };
            response.on('data', function(chunk) {
              var json = JSON.parse(chunk);
              if (json.user !== undefined) {
                req.session.user.profile = {
                  fullname: json.user.fullname,
                  emails: json.user.emails
                };
                res.send(200, {
                  authenticated: true,
                  username: proxyOptions.username,
                  profile: req.session.user.profile
                });
              } else {
                console.log('did not find chunk.user');
              }
            });
          }
        }
      });


    };

    var proxyCookieLogin = function(req, res, proxyOptions, callback) {

      proxyOptions = proxyOptions ? proxyOptions : {};
      var path     = proxyOptions.path ? proxyOptions.path : '/rest-cookie-auth/login.xqy';
      var method   = proxyOptions.method ? proxyOptions.method : 'post';

      proxy(req, res, {
        path: path,
        method: method,
        body: {
          username: proxyOptions.username,
          password: proxyOptions.password
        }
      },
      function(response) {
        //console.log('response: ' + util.inspect(response));
        if (response.statusCode === 403) {
          res.statusCode = 403;
          res.send('Unauthenticated');
        } else {
          if (response.statusCode === 200) {
            // authentication successful, remember the session id from MarkLogic
            handleMlCookie(req, response, proxyOptions);

            console.log('logged in with session id: ' + req.session.mlSessionId);

            res.status(200).send({
              authenticated: true,
              username: proxyOptions.username
            })
          }
        }
      });
    };

    var proxyLogout = function(req, res, proxyOptions, callback)  {
      if (usingCookies) return proxyCookieLogout(req, res, proxyOptions, callback);
      else              return proxyBasicLogout(req, res, proxyOptions, callback);
    }

    var proxyBasicLogout = function(req, res, proxyOptions, callback) {
      res.send(200);
    };

    var proxyCookieLogout = function(req, res, proxyOptions, callback) {

      proxyOptions = proxyOptions ? proxyOptions : {};
      var path     = proxyOptions.path ? proxyOptions.path : '/rest-cookie-auth/logout.xqy';

      proxy(req, res, {
        path: path
      },
      function(response) {
        res.send(200);
      });

    };

    var self = {
      init: init,
      proxy: proxy,
      proxyLogin: proxyLogin,
      proxyLogout: proxyLogout
    }

    return self;
};

module.exports = new mlProxy();

