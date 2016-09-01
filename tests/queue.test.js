var assert = require('assert');
var async = require('async');
var EventEmitter = require('events');
var ms = require('ms');
var redis = require('./lib.redis');
var redisLib = require('redis');
var Redlock = require('redlock');
var rewire = require('rewire');

var Queue = rewire('../lib/queue');

describe('queue', function () {
  var queue = new Queue({
    client: redis.redis,
    prefix: 'admiral-tests'
  });

  after(function (done) {
    redis.redis.EVAL('return redis.call("DEL", unpack(redis.call("KEYS", KEYS[1])))', 1, 'admiral-tests:*', done);
  });

  describe('constructor', function () {

    it('should create a queue successfully', function () {
      var created = new Queue({ client: redis.redis });

      assert.deepEqual(Object.keys(created), [ 'default_wait', 'lock_time', 'prefix', 'redis', 'redlock', 'events' ]);

      assert.equal(created.default_wait, '10m');
      assert.equal(created.lock_time, 300000);
      assert.equal(created.prefix, 'admiral');

      assert.ok(created.redis instanceof redisLib.RedisClient);
      assert.ok(created.redlock instanceof Redlock);
      assert.ok(created.events instanceof EventEmitter);
    });

    it('should throw if Redis isn\'t provided', function () {
      var err = null;

      try { new Queue({}); }
      catch (e) { err = e; }

      assert.ok(err instanceof Error);
      assert.equal(err.message, 'Missing redis client from opts');
    });

  });

  describe('#create', function () {

    before(function (done) {
      redis.assertEqualSMEMBERS('admiral-tests:list', [])(done);
    });

    it('should create a new type', function (done) {
      async.series([

        function (callback) {
          queue.create('karaoke', 'many-of-horror', callback);
        },
        redis.assertEqualSMEMBERS('admiral-tests:list', [ 'karaoke' ]),
        redis.assertEqualZCARD('admiral-tests:karaoke', 1)

      ], done);
    });

    it('should add a new IDs for types', function (done) {
      async.series([

        function (callback) {
          queue.create('karaoke', 'lets-dance-to-joy-division', callback);
        },
        redis.assertEqualSMEMBERS('admiral-tests:list', [ 'karaoke' ]),
        redis.assertEqualZCARD('admiral-tests:karaoke', 2)

      ], done);
    });

  });

  describe('#update', function () {

    before(function (done) {
      redis.assertEqualSMEMBERS('admiral-tests:list', [ 'karaoke' ])(done);
    });

    it('should update a time', function (done) {
      var time = Date.now() + ms('10m');
      async.series([

        function (callback) {
          queue.update('karaoke', 'many-of-horror', time, callback);
        },
        redis.assertEqualZCARD('admiral-tests:karaoke', 2),
        redis.assertEqualZSCORE('admiral-tests:karaoke', 'many-of-horror', time)

      ], done);
    });

  });

  describe('#exists', function () {

    before(function (done) {
      redis.assertEqualZMEMBERS('admiral-tests:karaoke', [ 'many-of-horror', 'lets-dance-to-joy-division' ])(done);
    });

    it('should confirm an entry exists', function (done) {
      queue.exists('karaoke', 'many-of-horror', function (err, exists) {
        if (!err) assert.ok(exists === true);
        done(err);
      });
    });

    it('should confirm an entry does not exists', function (done) {
      queue.exists('karaoke', 'you-need-me-man-i-dont-need-you', function (err, exists) {
        if (!err) assert.ok(exists === false);
        done(err);
      });
    });

  });

  describe('#list', function () {

    it('should list the members in the list', function (done) {
      queue.list('karaoke', function (err, members) {
        if (!err) assert.deepEqual(members, [ 'lets-dance-to-joy-division', 'many-of-horror' ]);
        done(err);
      });
    });

  });

  describe('#remove', function () {

    var NETSKY = [
      // https://open.spotify.com/album/5RpkF55XZzzpWO0CnqcWw8
      'rio', 'thunder', 'work-it-out', 'high-alert', 'leave-it-alone', 'who-knows', 'higher', 'tnt'
    ];

    before(function (done) {
      async.series([
        redis.assertEqualSMEMBERS('admiral-tests:list', [ 'karaoke' ]),
        redis.assertEqualZMEMBERS('admiral-tests:netsky', []),
        function (callback) {
          async.each(NETSKY, function (item, next) {
            queue.create('netsky', item, next);
          }, callback);
        },
        redis.assertEqualSMEMBERS('admiral-tests:list', [ 'karaoke', 'netsky' ]),
        redis.assertEqualZMEMBERS('admiral-tests:netsky', NETSKY.sort()),
      ], done);
    });

    after(function (done) {
      async.series([
        redis.assertEqualSMEMBERS('admiral-tests:list', [ 'karaoke' ]),
        redis.assertEqualZMEMBERS('admiral-tests:netsky', [])
      ], done);
    });

    it('should remove a member in the list', function (done) {
      async.series([
        function (callback) {
          queue.remove('netsky', NETSKY[0], callback);
        },
        redis.assertEqualZMEMBERS('admiral-tests:netsky', NETSKY.slice(1))
      ], done);
    });

    it('should remove the list', function (done) {
      async.series([
        function (callback) {
          async.each(NETSKY, function (item, next) {
            queue.remove('netsky', item, next);
          }, callback);
        },
        redis.assertEqualSMEMBERS('admiral-tests:list', [ 'karaoke' ]),
        redis.assertEqualZMEMBERS('admiral-tests:netsky', [])
      ], done);
    });

  });

  describe('#stats', function () {

    it('should return some stats', function (done) {
      queue.stats(function (err, stats) {
        if (err) return done(err);

        assert.deepEqual(stats, [
          {
            type: 'karaoke',
            count: 2
          }
        ]);
        done();
      });
    });

  });

  describe('#process', function () {
    var process = Queue.__get__('onEachTick');
    var members = [];

    before(function (done) {
      async.series([

        function (callback) {
          async.each([ 'id-1', 'id-2', 'id-3' ], function (item, next) {
            queue.create('karaoke', item, next);
          }, callback);
        },

        function (callback) {
          redis.redis.ZRANGE('admiral-tests:karaoke', 0, -1, function (err, list) {
            if (!err) members = list;
            callback(err);
          });
        }

      ], done);
    });

    var run = function (worker_name, worker_fn) {
      return function (callback) {
        var ran = false;
        process.call(queue, worker_name, function (job, done) {
          ran = true;
          worker_fn(job, done);
        }, function (err) {
          if (err) return callback(err);

          assert.ok(ran, 'Failed to run the worker fn for ' + worker_name);
          callback();
        });
      };
    };

    it('should process a job correctly', run('karaoke', function (job, callback) {
      assert.ok(members.indexOf(job.id) >= 0);
      callback();
    }));

    it('should extend a lock successfully', run('karaoke', function (job, callback) {
      job.extend('2m', function (err) {
        if (err) return callback(err);

        assert.ok(members.indexOf(job.id) >= 0);
        callback(null, '5m');
      });
    }));

    it('should let you unlock a job during the worker function', run('karaoke', function (job, callback) {
      job.unlock(function (err) {
        if (err) return callback(err);

        assert.ok(members.indexOf(job.id) >= 0);
        callback(null, '5m');
      });
    }));

  });

});
