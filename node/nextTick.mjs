console.log (' 同步开始 ');
Promise.resolve ().then (() => console.log ('Promise 1'));
process.nextTick (() => console.log ('nextTick 1'));
Promise.resolve ().then (() => console.log ('Promise 2'));
process.nextTick (() => console.log ('nextTick 2'));
console.log (' 同步结束 ');