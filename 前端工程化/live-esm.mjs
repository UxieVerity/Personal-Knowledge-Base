// ESM：export 的命名绑定是 live binding
export let value = 1;
setTimeout(() => {
  value = 999; // 修改的是绑定本身
}, 50);
