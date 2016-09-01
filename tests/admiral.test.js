var assert = require('assert');
var rewire = require('rewire');

var admiral = rewire('../lib/admiral');

describe('admiral', function () {

  describe('createQueue', function () {

    var revert = null;
    before(function () {
      revert = admiral.__set__({
        Queue: function Queue(opts) {
          return Object.assign({ type: 'QUEUE' }, opts);
        },
        redis: {
          createClient: function () {
            return 'REDIS';
          }
        }
      });
    });
    after(function () {
      revert();
    });

    it('should create a Queue with an existing Redis connection', function () {
      var queue = admiral.createQueue({
        client: 'REDIS'
      });

      assert.deepEqual(queue, {
        type: 'QUEUE',
        client: 'REDIS'
      });
    });

    it('should create a Queue with a new Redis connection', function () {
      var queue = admiral.createQueue({
        redis: {
          host: 'localhost',
          port: 6379
        }
      });

      assert.deepEqual(queue, {
        type: 'QUEUE',
        redis: {
          host: 'localhost',
          port: 6379
        },
        client: 'REDIS'
      });
    });

    it('should create a Queue with a new Redis connection with all defaults', function () {
      var queue = admiral.createQueue();

      assert.deepEqual(queue, {
        type: 'QUEUE',
        client: 'REDIS'
      });
    });

    it('should throw if Redis isn\'t installed alongside of Admiral and a client isn\'t specified', function () {
      var err = null;
      var revert = admiral.__set__('redis', null);

      try { admiral.createQueue(); }
      catch (e) { err = e; }

      assert.ok(err instanceof Error);
      assert.equal(err.message, 'Redis not installed');
      revert();
    });

  });

});
