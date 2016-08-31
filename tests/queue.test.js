var assert = require('assert');
var async = require('async');
var EventEmitter = require('events');
var redisLib = require('redis');
var Redlock = require('redlock');

var Queue = require('../lib/queue');
var redis = redisLib.createClient();

describe('queue', function () {
  var queue = new Queue({
    prefix: 'admiral-tests',
    redis: redis
  });

  after(function (done) {
    redis.EVAL('return redis.call("DEL", unpack(redis.call("KEYS", KEYS[1])))', 1, 'admiral-tests:*', done);
  });

  describe('constructor', function () {

    it('should create a queue successfully', function () {
      var created = new Queue({ redis: redis });

      assert.deepEqual(Object.keys(created), [ 'default_wait', 'lock_time', 'prefix', 'redis', 'redlock', 'events' ]);

      assert.equal(created.default_wait, '10m');
      assert.equal(created.lock_time, 300000);
      assert.equal(created.prefix, 'admiral');

      assert.ok(created.redis instanceof redisLib.RedisClient);
      assert.ok(created.redlock instanceof Redlock);
      assert.ok(created.events instanceof EventEmitter);
    });

  });

  describe('#create', function () {

    before(function (done) {
      redis.SMEMBERS('admiral-tests:list', function (err, types) {
        if (err) return done(err);

        assert.deepEqual(types, []);
        done();
      });
    });

    it('should create a new type', function (done) {
      async.waterfall([

        function (waterfallCb) {
          queue.create('karaoke', 'many-of-horror', waterfallCb);
        },
        function (waterfallCb) {
          redis.SMEMBERS('admiral-tests:list', function (err, types) {
            if (err) return waterfallCb(err);

            assert.deepEqual(types, [ 'karaoke' ]);
            waterfallCb();
          });
        },
        function (waterfallCb) {
          redis.ZCARD('admiral-tests:karaoke', function (err, count) {
            if (err) return waterfallCb(err);

            assert.equal(count, 1);
            waterfallCb();
          });
        }

      ], done);
    });

    it('should add a new IDs for types', function (done) {
      async.waterfall([

        function (waterfallCb) {
          queue.create('karaoke', 'lets-dance-to-joy-division', waterfallCb);
        },
        function (waterfallCb) {
          redis.SMEMBERS('admiral-tests:list', function (err, types) {
            if (err) return waterfallCb(err);

            assert.deepEqual(types, [ 'karaoke' ]);
            waterfallCb();
          });
        },
        function (waterfallCb) {
          redis.ZCARD('admiral-tests:karaoke', function (err, count) {
            if (err) return waterfallCb(err);

            assert.equal(count, 2);
            waterfallCb();
          });
        }

      ], done);
    });

  });

});
