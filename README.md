# Admiral

[![Circle CI](https://circleci.com/gh/car-throttle/admiral/tree/master.svg?style=shield)](https://circleci.com/gh/car-throttle/admiral/tree/master)

Admiral is a distributed job-scheduling library in Node.JS, so you can run a function at regular intervals without
needing to queue "job" in a standard queue infrastructure with a CRON.

Backed by Redis & using [redlock](https://npm.im/redlock), you can launch as many workers as you'd like, to pick up
tasks without the need to run a master.

----

Take a structure like so:

```
== very-important-tasks ==

[ id-1 ][  1 minute  ]
[ id-2 ][  3 minutes ]
[ id-3 ][  4 minutes ]
[ id-4 ][  2 minutes ]
[ id-5 ][  1 minute  ]
[ id-6 ][ 12 minutes ]
```

This library will read `1` & `5`, then `4` a minute later, `2` a minute later, and so on, picking up jobs as their wait
time expires. If all the workers are busy then the job will be picked up as soon as a worker becomes available,
regardless of it's wait time (since it's wait time has elapsed). This means the scheduler can guarantee that a job will
be run **at least or after** it's wait time has elapsed.

----

```js
var admiral = require('admiral');

var queue = admiral.createQueue();

queue.process('very-important-tasks', function (job, callback) {
  aVeryImportantAsyncFn(job.id, function (err) {
    if (err) console.error(err);
    callback();
  });
});
```

https://en.wikipedia.org/wiki/List_of_hop_varieties#Admiral

## Installation

```
npm install --save car-throttle/admiral
```

You can always guarantee that `master` branch will be stable. Any features or fixes will be worked on in a branch &
merged in as appropriate.

## Usage

### Initialising

```js
var queue = admiral.createQueue(opts);
```

If you're running Redis on the machine, you'll be able to start working with Admiral without adding any additional
options. The options for `createQueue` let you change default behaviours and set the Redis connections like so:

```js
admiral.createQueue({
  prefix: 'my-awesome-project', // A prefix of all the keys, defaults to `admiral`, and should not be changed
  client: require('redis').createClient({ // To optionally pass a pre-configured Redis client
    host: 'localhost',
    port: 4532,
    auth: 'secret-password'
  }),
  redis: { // Pass an object to a new `redis.createClient` constructor
    host: '192.168.100.121',
    port: 6379
  },
  default_wait: '10m', // The amount of time before a job will be redone (can be overridden on a per-job basis)
  lock_time: '10m' // The amount of time to give each job (before the lock expires)
});
```

If you pass both `client` **and** `redis` properties, the existing `client` will take precedence over the `redis`
options. Most of the time, unless you're certain about what you're doing, you'll probably want to have a separate Redis
connection for Admiral.

### Queuing IDs

```js
queue.create('very-important-tasks', 'id-1', function (err) {

});
```

This will implicitly create the queue for you, and add `id-1` to the front of the queue. Any workers waiting to process
jobs for `very-important-tasks` will pick up the ID and begin working immediately!

### Checking if an ID exists

```js
queue.exists('very-important-tasks', 'id-1', function (err, exists) {
  console.log(exists); // true/false
});
```

### Removing an ID from the queue

```js
queue.remove('very-important-tasks', 'id-1', function (err) { });
```

### Updating the next-run-time for an ID in the queue

```js
queue.update('very-important-tasks', 'id-1', Date.now(), function (err) { });
```

### Getting the next-run time for an ID in the queue

```js
queue.get('very-important-tasks', 'id-1', function (err, timestamp) { });
```

### Return all the IDs for a queue

```js
queue.list('very-important-tasks', function (err, ids) {
  console.log(ids); // [ 'id-1' ]
});
```

### Stats

This returns the number of items in each sorted set.

```js
queue.stats(function (err, stats) {
  console.log(stats); // [ { type: 'very-important-tasks', count: 1 } ]
});
```

*Future:* Return how many items are currently being processed (requires more calls & structures in Redis)

### Processing

The `process` method takes a function and will run each ID through this function, once an exclusive lock has been
successfully acquired with redlock.

```js
queue.process('very-important-tasks', function (job, callback) {
  console.log(job.id); // The ID of the entry ("id-1")
  console.log(job.timestamp); // The UNIX timestamp it was supposed to run at

  job.extend('2m', function (err) {
    // A method to extend the amount of time the lock is held for
    // AS PER REDLOCK LIMITATIONS, you must extend the lock whist the lock is still acquired
    // If the lock has expired, you won't be able to extend the lock (and an error will be returned)
  });

  job.unlock(function (err) {
    // Optionally, you can release the lock in your own code
    // If you do, there is a chance another worker could pick up this job WHILST this worker still has this job
    // Use with caution
  });

  callback(err, '10m'); // Any errors passed here will be emitted with as a "job error" event
  // You can also pass an offset to push back this job a certain amount (overriding the default_wait time)
});
```

## Events

There is an `EventEmitter` within the queue, so you can listen on events within the queue.

```js
queue.on('error', function (err) {
  // Returns errors from within queue.process
  // Usually Redis errors, errors from the sorted-set operations
  // And redlock errors when failing to acquire locks
});

queue.on('job error', function (err) {
  // Any errors passed back to the callback in the function passed to queue.process will be emitted here
});
```

## Notes

- `8s`, `5m`, `8h`, `3 days` confusing you? Check out [`ms`](https://npm.im/ms), an amazing ms conversion library!
- Questions? Awesome! [Open an issue](https://github.com/car-throttle/admiral) to get started!
