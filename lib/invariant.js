// src/invariant.ts
var PACKAGE_NAME = "@deepseek-ai/dsh-client-ui-whale-pet";
var name = "client-ui-whale-pet-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
