var EventEmitter = require('events');
var ms = require('ms');
var Redlock = require('redlock');

var TWO_MINUTES = ms('2m');

function Queue(opts) {
  if (!opts.client) throw new Error('Missing redis client from opts');

  this.default_wait = opts.default_wait || '10m';
  this.lock_time = ms(opts.lock_time || '5m');
  this.prefix = opts.prefix || 'admiral';

  this.redis = opts.client;
  this.redlock = new Redlock([ this.redis ]);

  this.events = new EventEmitter();
}

/* istanbul ignore next  */
function emitErr(queue, err, prefix) {
  err.message = prefix + ': ' + err.message;
  queue.events.emit('error', err);
}

/**
 * Manipulation methods
 */

/**
 * ZADD {prefix}:{type} Date.now() {id}
 * SADD {prefix}:list {type}
 */
Queue.prototype.create = function (type, id, callback) {
  this.update(type, id, Date.now(), callback);
};

/**
 * ZSCORE {prefix}:{type} {id} => BOOLEAN
 */
Queue.prototype.exists = function (type, id, callback) {
  this.get(type, id, function (err, score) {
    callback(err, !!score);
  });
};

/**
 * ZSCORE {prefix}:{type} {id} => BOOLEAN
 */
Queue.prototype.get = function (type, id, callback) {
  this.redis.ZSCORE(this.prefix + ':' + type, id, function (err, score) {
    callback(err, score || null);
  });
};

/**
 * ZRANGE {prefix}:{type} 0 -1
 */
Queue.prototype.list = function (type, callback) {
  this.redis.ZRANGE(this.prefix + ':' + type, 0, -1, callback);
};

/**
 * ZREM {prefix}:{type} {id}
 * EVAL if redis.call("ZCARD", KEYS[1]) > 0 then return redis.call("SREM", KEYS[2], ARGV[1]) else return 0 end
 */
Queue.prototype.remove = function (type, id, callback) {
  var multi = this.redis.multi();
  multi.ZREM(this.prefix + ':' + type, id);

  multi.EVAL(
    'if redis.call("ZCARD", KEYS[1]) > 0 then return redis.call("SREM", KEYS[2], ARGV[1]) else return 0 end', 2,
    this.prefix + ':' + type, this.prefix + ':list', type
  );

  multi.exec(function (err) {
    callback(err);
  });
};

/**
 * SMEMBERS {prefix}:list
 * For-Each-Type: ZCARD {prefix}:{type}
 */
Queue.prototype.stats = function (callback) {
  var queue = this;

  queue.redis.SMEMBERS(this.prefix + ':list', function (err, types) {
    /* istanbul ignore if  */
    if (err) return callback(err);

    var multi = queue.redis.multi();
    types.forEach(function (type) {
      multi.ZCARD(queue.prefix + ':' + type);
    });

    multi.exec(function (err, results) {
      /* istanbul ignore if  */
      if (err) return callback(err);

      results = results.map(function (count, i) {
        return {
          type: types[i],
          count: count || 0
        };
      });

      callback(null, results);
    });
  });
};

/**
 * ZADD {prefix}:{type} Date.now() {id}
 * SADD {prefix}:list {type}
 */
Queue.prototype.update = function (type, id, timestamp, callback) {
  var multi = this.redis.multi();

  multi.ZADD(this.prefix + ':' + type, timestamp, id);
  multi.SADD(this.prefix + ':list', type); // In case someone calls UPDATE before CREATE

  multi.exec(function (err) {
    callback(err);
  });
};

/**
 * Processing methods
 */

Queue.prototype.on = function () {
  this.events.on.apply(this.events, arguments);
};

/**
 * EACH TICK
 *   1. Read the youngest entry in the sorted set
 *   2. Acquire an exclusive lock
 *   3. Update the timer so that other workers don't sit looping on this (now locked) entry
 *   4. Let the worker do it's thing
 *   5. Unlock it & tick over
 */
Queue.prototype.process = function (type, worker_fn) {
  var key = this.prefix + ':' + type;
  var queue = this;

  process.nextTick(function iterateFn() {
    // Pull item off the SORTED SET where the date is less than NOW and if no item, then loops
    queue.redis.ZRANGEBYSCORE(key, 0, Date.now(), 'WITHSCORES', 'LIMIT', '0', '1', function (err, results) {
      /* istanbul ignore if  */
      if (err) {
        emitErr(queue, err, 'Failed to fetch member from the ZSET');
        return process.nextTick(iterateFn);
      }
      if (!Array.isArray(results) || results.length !== 2) {
        return setTimeout(function () {
          process.nextTick(iterateFn);
        }, 1000);
      }

      var job = {
        type: type,
        id: results[0],
        timestamp: results[1]
      };

      if (!job.id || !job.timestamp) {
        emitErr(queue, new Error('Missing id/timestamp for job: ' + JSON.stringify(job)), 'Failed to fetch member');
        return process.nextTick(iterateFn);
      }

      queue.update(type, job.id, Date.now() + TWO_MINUTES, function (err) {
        /* istanbul ignore if  */
        if (err) {
          emitErr(queue, err, 'Failed to update ' + type + ':' + job.id);
          return process.nextTick(iterateFn);
        }

        queue.redlock.lock(key + ':locks:' + job.id, queue.lock_time, function (err, lock) {
          /* istanbul ignore if  */
          if (err) {
            emitErr(queue, err, 'Failed to lock ' + type + ':' + job.id);
            return process.nextTick(iterateFn);
          }

          /**
           * EXTEND the amount of time the job is locked for
           * AS PER REDLOCK LIMITATIONS, you must extend the lock whist the lock is acquired
           *   If the lock has expired, you won't be able to extend the lock!
           * Pleasantly wrapped to use the ms library <3
           */
          job.extend = function (offset, callback) {
            lock.extend(ms(offset), callback);
          };

          var IS_LOCKED = true;
          /**
           * Releasing the lock means other workers "could" pick it up again after queue.default_wait has passed
           * Use with CAUTION in your own functions
           */
          job.unlock = function (callback) {
            if (!IS_LOCKED) return callback();
            lock.unlock(function (err) {
              if (!err) IS_LOCKED = false;
              callback(err);
            });
          };

          worker_fn(job, function (err, offset) {
            /* istanbul ignore if  */
            if (err) queue.events.emit('job error', err);

            job.unlock(function (err) {
              if (err) emitErr(queue, err, 'Failed to unlock ' + type + ':' + job.id);
              queue.update(type, job.id, Date.now() + ms(offset || queue.default_wait), function (err) {
                if (err) emitErr(queue, err, 'Failed to update the time for ' + type + ':' + job.id);
                return process.nextTick(iterateFn);
              });
            });
          });
        });
      });
    });
  });
};

module.exports = Queue;
