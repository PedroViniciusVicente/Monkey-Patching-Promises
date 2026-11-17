import vm from 'node:vm'; // https://nodejs.org/api/vm.html#moduleevaluateoptions

const module = new vm.SyntheticModule(
  ['value'],
  function() {
    this.setExport('value', 42);
  }
);
await module.link(() => {});
await module.evaluate(); // [returns promise: module.evaluate]
console.log(module.namespace.value);