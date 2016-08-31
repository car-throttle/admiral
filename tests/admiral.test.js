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
          createClient: function (opts) {
            assert.deepEqual(opts, {
              host: 'localhost',
              port: 6379
            });

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

  });

});
