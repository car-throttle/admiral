var admiral = module.exports = {};
var Queue = require('./queue');

// var express = null;
// try { express = require('express'); }
// catch (err) { /* If EXPRESS ain't installed then we'll deal with it later */ }

var redis = null;
try { redis = require('redis'); }
catch (err) { /* If REDIS ain't installed then we'll deal with it later */ }

admiral.createQueue = function (opts) {
  opts = opts || {};
  if (!opts.client) {
    if (!redis || !redis.createClient) {
      throw new Error('Redis not installed');
    }

    opts.client = redis.createClient(opts.redis || {});
  }

  return new Queue(opts);
};

// admiral.api = function (queue, opts) {
//   if (!express) throw new Error('Express not installed');
//   opts = opts || {};
//
//   var router = express.Router();
//
//   router.get('/', function (req, res, next) {
//     queue.getStats(function (err, stats) {
//       if (err) return next(err);
//
//       res.json(stats);
//     });
//   });
//
//   return router;
// };
