// node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
function defineProperty(object, key, value) {
  return Object.defineProperty(object, key, {
    writable: true,
    value,
    enumerable: false
  });
}
var write = /* @__PURE__ */ Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
  if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
  } finally {
    ancestors.delete(value);
  }
}
function createVolatile(value) {
  let current = snapshot(value);
  return Object.freeze({
    get: () => current,
    [write]: (value2) => {
      current = value2;
    }
  });
}
function isVolatile(value) {
  return typeof value === "object" && value !== null && write in value;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  const ancestors = /* @__PURE__ */ new Set();
  function compare(a2, b2) {
    if (a2 === b2) return true;
    if (isVolatile(a2) || isVolatile(b2)) return isVolatile(a2) && isVolatile(b2);
    if (!strict && isNullable(a2) && isNullable(b2)) return true;
    if (typeof a2 !== typeof b2 || typeof a2 !== "object" || !a2 || !b2) return false;
    if (ancestors.has(a2)) return false;
    function check(test, then) {
      return test(a2) ? test(b2) ? then(a2, b2) : false : test(b2) ? false : void 0;
    }
    ancestors.add(a2);
    try {
      return check(Array.isArray, (a3, b3) => {
        if (a3.length !== b3.length) return false;
        for (let index = 0; index < a3.length; index++) if (!compare(a3[index], b3[index])) return false;
        return true;
      }) ?? check(is("Date"), (a3, b3) => a3.valueOf() === b3.valueOf()) ?? check(is("URL"), (a3, b3) => a3.href === b3.href) ?? check(is("RegExp"), (a3, b3) => a3.source === b3.source && a3.flags === b3.flags) ?? check(isArrayBufferLike, (a3, b3) => {
        if (a3.byteLength !== b3.byteLength) return false;
        const viewA = new Uint8Array(a3);
        const viewB = new Uint8Array(b3);
        for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
        return true;
      }) ?? ((!strict || [a2, b2].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
        ...a2,
        ...b2
      }).every((key) => compare(a2[key], b2[key])));
    } finally {
      ancestors.delete(a2);
    }
  }
  return compare(a, b);
}
function tokenize(source, delimiters, delimiter) {
  const output = [];
  let state = 0;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      if (state === 1) {
        const next = source.charCodeAt(i + 1);
        if (next >= 97 && next <= 122) output.push(delimiter);
        output.push(code + 32);
      } else {
        if (state !== 0) output.push(delimiter);
        output.push(code + 32);
      }
      state = 1;
    } else if (code >= 97 && code <= 122) {
      output.push(code);
      state = 2;
    } else if (delimiters.includes(code)) {
      if (state !== 0) output.push(delimiter);
      state = 0;
    } else output.push(code);
  }
  return String.fromCharCode(...output);
}
function paramCase(source) {
  return tokenize(source, [45, 95], 45);
}
var hyphenate = paramCase;
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// node_modules/@deepseek-ai/cordis/lib/index.js
var DisposableList = class {
  sn = 0;
  map = /* @__PURE__ */ new Map();
  weak = /* @__PURE__ */ new WeakMap();
  get length() {
    return this.map.size;
  }
  push(value) {
    const sn = ++this.sn;
    this.map.set(sn, value);
    this.weak.set(value, sn);
    return () => this.map.delete(sn);
  }
  delete(value) {
    const sn = this.weak.get(value);
    if (!sn) return false;
    return this.map.delete(sn);
  }
  clear() {
    const values = [...this.map.values()];
    this.map.clear();
    return values.reverse();
  }
  [Symbol.iterator]() {
    return this.map.values();
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return [...this];
  }
};
var symbols = {
  shadow: /* @__PURE__ */ Symbol.for("cordis.shadow"),
  receiver: /* @__PURE__ */ Symbol.for("cordis.receiver"),
  original: /* @__PURE__ */ Symbol.for("cordis.original"),
  metadata: /* @__PURE__ */ Symbol.for("cordis.metadata"),
  initHooks: /* @__PURE__ */ Symbol.for("cordis.initHooks"),
  checkProto: /* @__PURE__ */ Symbol.for("cordis.checkProto"),
  effect: /* @__PURE__ */ Symbol.for("cordis.effect"),
  filter: /* @__PURE__ */ Symbol.for("cordis.filter"),
  isolate: /* @__PURE__ */ Symbol.for("cordis.isolate"),
  intercept: /* @__PURE__ */ Symbol.for("cordis.intercept"),
  init: /* @__PURE__ */ Symbol.for("cordis.init"),
  check: /* @__PURE__ */ Symbol.for("cordis.check"),
  config: /* @__PURE__ */ Symbol.for("cordis.config"),
  invoke: /* @__PURE__ */ Symbol.for("cordis.invoke"),
  extend: /* @__PURE__ */ Symbol.for("cordis.extend"),
  tracker: /* @__PURE__ */ Symbol.for("cordis.tracker"),
  resolveConfig: /* @__PURE__ */ Symbol.for("cordis.resolveConfig")
};
var GeneratorFunction = function* () {
}.constructor;
var AsyncGeneratorFunction = async function* () {
}.constructor;
function isConstructor(func) {
  if (!func.prototype) return false;
  if (func instanceof GeneratorFunction) return false;
  if (AsyncGeneratorFunction !== Function && func instanceof AsyncGeneratorFunction) return false;
  return true;
}
function joinPrototype(proto1, proto2) {
  if (proto1 === Object.prototype) return proto2;
  const result = Object.create(joinPrototype(Object.getPrototypeOf(proto1), proto2));
  for (const key of Reflect.ownKeys(proto1)) Object.defineProperty(result, key, Object.getOwnPropertyDescriptor(proto1, key));
  return result;
}
function isObject(value) {
  return value && (typeof value === "object" || typeof value === "function");
}
function getPropertyDescriptor(target, prop) {
  let proto = target;
  while (proto) {
    const desc = Reflect.getOwnPropertyDescriptor(proto, prop);
    if (desc) return desc;
    proto = Object.getPrototypeOf(proto);
  }
}
function getTraceable(ctx, value) {
  if (!isObject(value)) return value;
  if (Object.hasOwn(value, symbols.shadow)) return Object.getPrototypeOf(value);
  const tracker = value[symbols.tracker];
  if (!tracker) return value;
  return createTraceable(ctx, value, tracker);
}
function withProps(target, props) {
  if (!props) return target;
  return new Proxy(target, {
    get: (target2, prop, receiver) => {
      if (prop in props && prop !== "constructor") return Reflect.get(props, prop, receiver);
      return Reflect.get(target2, prop, receiver);
    },
    set: (target2, prop, value, receiver) => {
      if (prop in props && prop !== "constructor") return Reflect.set(props, prop, value, receiver);
      return Reflect.set(target2, prop, value, receiver);
    }
  });
}
function withProp(target, prop, value) {
  return withProps(target, Object.defineProperty(/* @__PURE__ */ Object.create(null), prop, {
    value,
    writable: false
  }));
}
function createShadow(ctx, target, property2, receiver) {
  if (!property2) return receiver;
  const origin = Reflect.getOwnPropertyDescriptor(target, property2)?.value;
  if (!origin) return receiver;
  return withProp(receiver, property2, ctx.extend({ [symbols.shadow]: origin }));
}
function createShadowMethod(ctx, value, outer, shadow) {
  return new Proxy(value, { apply: (target, thisArg, args) => {
    if (thisArg === outer) thisArg = shadow;
    return getTraceable(ctx, Reflect.apply(target, thisArg, args));
  } });
}
function createTraceable(ctx, value, tracker) {
  if (ctx[symbols.shadow] && !tracker.noShadow) ctx = Object.getPrototypeOf(ctx);
  const proxy = new Proxy(value, {
    get: (target, prop, receiver) => {
      if (prop === symbols.original) return target;
      if (prop === tracker.property) return ctx;
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) return Reflect.get(ctx, `${tracker.associate}.${prop}`, withProp(ctx, symbols.receiver, receiver));
      let shadow, innerValue;
      const desc = getPropertyDescriptor(target, prop);
      if (desc && "value" in desc) innerValue = desc.value;
      else {
        shadow = createShadow(ctx, target, tracker.property, receiver);
        innerValue = Reflect.get(target, prop, shadow);
      }
      const innerTracker = innerValue?.[symbols.tracker];
      if (innerTracker) return createTraceable(ctx, innerValue, innerTracker);
      else if (!tracker.noShadow && typeof innerValue === "function") {
        shadow ??= createShadow(ctx, target, tracker.property, receiver);
        return createShadowMethod(ctx, innerValue, receiver, shadow);
      } else return innerValue;
    },
    set: (target, prop, value2, receiver) => {
      if (prop === symbols.original) return false;
      if (prop === tracker.property) return false;
      if (typeof prop === "symbol") return Reflect.set(target, prop, value2, receiver);
      if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) return Reflect.set(ctx, `${tracker.associate}.${prop}`, value2, withProp(ctx, symbols.receiver, receiver));
      const shadow = createShadow(ctx, target, tracker.property, receiver);
      return Reflect.set(target, prop, value2, shadow);
    },
    apply: (target, thisArg, args) => {
      return applyTraceable(proxy, target, thisArg, args);
    }
  });
  return proxy;
}
function applyTraceable(proxy, value, thisArg, args) {
  if (!value[symbols.invoke]) return Reflect.apply(value, thisArg, args);
  return value[symbols.invoke].apply(proxy, args);
}
function createCallable(name, proto, tracker) {
  const self = function(...args) {
    return applyTraceable(createTraceable(self["ctx"], self, tracker), self, this, args);
  };
  defineProperty(self, "name", name);
  return Object.setPrototypeOf(self, proto);
}
function handleError(info, reason, getOuterStack) {
  const innerLines = info.error.stack.split("\n");
  if (typeof reason?.stack !== "string") {
    const outerError = new Error(reason);
    const lines2 = outerError.stack.split("\n");
    lines2.splice(1, Infinity, ...getOuterStack());
    outerError.stack = lines2.join("\n");
    throw outerError;
  }
  const lines = reason.stack.split("\n");
  let index = lines.indexOf(innerLines[2]);
  if (index === -1) throw reason;
  index -= info.offset;
  while (index > 0) {
    if (!lines[index - 1].endsWith(" (<anonymous>)")) break;
    index -= 1;
  }
  lines.splice(index, Infinity, ...getOuterStack());
  reason.stack = lines.join("\n");
  throw reason;
}
function composeError(callback, getOuterStack = buildOuterStack()) {
  const info = {
    offset: 1,
    error: /* @__PURE__ */ new Error()
  };
  try {
    const result = callback(info);
    if (isObject(result) && "then" in result) return result.then(void 0, (reason) => handleError(info, reason, getOuterStack));
    else return result;
  } catch (reason) {
    handleError(info, reason, getOuterStack);
  }
}
function buildOuterStack(offset = 0) {
  const outerError = /* @__PURE__ */ new Error();
  return () => outerError.stack.split("\n").slice(3 + offset);
}
function isBailed(value) {
  return value !== null && value !== false && value !== void 0;
}
var EventsService = class {
  ctx;
  _hooks = {};
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, symbols.tracker, {
      property: "ctx",
      noShadow: true
    });
    this.on("internal/listener", function(name, listener, options) {
      if (name === "internal/update" && !options.global) return (this.fiber._hooks["internal/update"] ??= new DisposableList())[options.prepend ? "unshift" : "push"](listener);
    });
    this.on("internal/update", function(config, noSave, next) {
      const cbs = [...this._hooks["internal/update"] || []];
      const _next = () => {
        return (cbs.shift() ?? next).call(this, config, noSave, _next);
      };
      return _next();
    }, {
      global: true,
      prepend: true
    });
  }
  /**
  * Resolve listeners for one dispatch and apply context filtering.
  *
  * @param type — the dispatch mode, reported on `internal/dispatch`.
  * @param args — the raw dispatch arguments; consumed up to the event name.
  * @returns the matching listener callbacks, bound to the dispatch `this`.
  */
  dispatch(type, args) {
    const thisArg = typeof args[0] === "object" || typeof args[0] === "function" ? args.shift() : null;
    const name = args.shift();
    if (!name.startsWith("internal/")) this.emit("internal/dispatch", type, name, args, thisArg);
    const filter = thisArg?.[Context.filter];
    return (this._hooks[name] || []).filter((hook) => hook.global || !filter || filter.call(thisArg, hook.ctx)).map((hook) => hook.callback.bind(thisArg));
  }
  /**
  * Run listeners concurrently and wait for all of them.
  *
  * @param args — optional `this`, the event name, then listener arguments.
  * @returns a promise resolving once every listener has settled.
  */
  async parallel(...args) {
    const errors = (await Promise.allSettled(this.dispatch("emit", args).map(async (cb) => cb(...args)))).filter((result) => result.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map((error) => error.reason));
  }
  /**
  * Run listeners synchronously without waiting for returned promises.
  *
  * @param args — optional `this`, the event name, then listener arguments.
  */
  emit(...args) {
    this.dispatch("emit", args).map((cb) => cb(...args));
  }
  /**
  * Run listeners in order, awaiting each, until one returns a bail value.
  *
  * @param args — optional `this`, the event name, then listener arguments.
  * @returns the first bail value (see {@link isBailed}), if any.
  */
  async serial(...args) {
    for (const cb of this.dispatch("serial", args)) {
      const result = await cb(...args);
      if (isBailed(result)) return result;
    }
  }
  /**
  * Run listeners synchronously until one returns a bail value.
  *
  * @param args — optional `this`, the event name, then listener arguments.
  * @returns the first bail value (see {@link isBailed}), if any.
  */
  bail(...args) {
    for (const cb of this.dispatch("bail", args)) {
      const result = cb(...args);
      if (isBailed(result)) return result;
    }
  }
  /**
  * Compose listeners around the final `next` callback.
  *
  * The last dispatch argument is treated as the innermost `next`. Listeners
  * run outermost-first; a listener that does not call `next()` vetoes the
  * rest of the chain, including the built-in behavior.
  *
  * @param args — optional `this`, the event name, listener arguments, then `next`.
  * @returns the outermost listener's return value.
  */
  waterfall(...args) {
    const cbs = this.dispatch("waterfall", args);
    const inner = args.pop();
    const next = () => {
      return (cbs.shift() ?? inner)(...args);
    };
    args.push(next);
    return next();
  }
  /**
  * Store a listener record as an effect on the current fiber.
  *
  * @param label — effect label shown in fiber diagnostics.
  * @param hooks — the listener list for one event.
  * @param callback — the listener to store.
  * @param options — placement and filtering options.
  * @returns a disposer that unregisters the listener.
  */
  register(label, hooks, callback, options) {
    const method = options.prepend ? "unshift" : "push";
    return this.ctx.fiber.effect(() => {
      hooks[method]({
        ctx: this.ctx,
        callback,
        ...options
      });
      return () => this.unregister(hooks, callback);
    }, label);
  }
  /**
  * Remove a stored listener record.
  *
  * @param hooks — the listener list for one event.
  * @param callback — the listener to remove.
  * @returns `true` if the listener was found and removed.
  */
  unregister(hooks, callback) {
    const index = hooks.findIndex((hook) => hook.callback === callback);
    if (index >= 0) {
      hooks.splice(index, 1);
      return true;
    }
  }
  /**
  * Register an event listener owned by the current fiber.
  *
  * The listener is removed automatically when the fiber unloads. Throws
  * `CordisError('INACTIVE_EFFECT')` if the fiber is already disposed.
  *
  * @param name — the event name to listen for.
  * @param listener — called with the dispatch arguments.
  * @param options — listener options; a boolean is shorthand for `prepend`.
  * @returns a disposer removing the listener; `true` if it was still registered.
  */
  on(name, listener, options) {
    if (typeof options !== "object") options = { prepend: options };
    this.ctx.fiber.assertActive();
    listener = this.ctx.reflect.bind(listener);
    const result = this.bail(this.ctx, "internal/listener", name, listener, options);
    if (result) return result;
    const hooks = this._hooks[name] ||= [];
    const label = `ctx.on(${typeof name === "string" ? JSON.stringify(name) : name.toString()})`;
    return this.register(label, hooks, listener, options);
  }
  /**
  * Register an event listener that disposes itself after the first call.
  *
  * @param name — the event name to listen for.
  * @param listener — called at most once with the dispatch arguments.
  * @param options — listener options; a boolean is shorthand for `prepend`.
  * @returns a disposer removing the listener; `true` if it was still registered.
  */
  once(name, listener, options) {
    const dispose = this.on(name, function(...args) {
      dispose();
      return listener.apply(this, args);
    }, options);
    return dispose;
  }
};
var defaultFormatters = {
  s: (value) => String(value),
  d: (value) => Math.trunc(Number(value)),
  i: (value) => Math.trunc(Number(value)),
  f: (value) => Number(value),
  o: (value) => JSON.stringify(value),
  O: (value) => JSON.stringify(value),
  c: () => "",
  C: (value, exporter, message) => {
    return Logger.color(exporter, Logger.code(message.name, exporter.colors), value);
  }
};
function isAggregateError(error) {
  return error instanceof Error && Array.isArray(error["errors"]);
}
var Logger = class {
  service;
  static color(exporter, code, value, decoration = "") {
    if (!exporter.colors) return "" + value;
    return `\x1B[3${code < 8 ? code : "8;5;" + code}${exporter.colors >= 2 ? decoration : ""}m${value}\x1B[0m`;
  }
  static code(name, level) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash << 3) - hash + name.charCodeAt(i) + 13;
      hash |= 0;
    }
    const colors = !level ? [] : level >= 2 ? c256 : c16;
    return colors[Math.abs(hash) % colors.length];
  }
  static format(exporter, message) {
    const args = message.args.slice();
    if (args[0] instanceof Error) {
      args[0] = args[0].stack || args[0].message;
      args.unshift("%s");
    } else if (typeof args[0] !== "string") args.unshift("%o");
    let format = args.shift();
    format = format.replace(/%([a-zA-Z%])/g, (match, char) => {
      if (match === "%%") return "%";
      const formatter = exporter.formatters?.[char] ?? defaultFormatters[char];
      if (typeof formatter === "function") return formatter(args.shift(), exporter, message);
      return match;
    });
    const oFormatter = exporter.formatters?.o ?? defaultFormatters.o;
    for (let arg of args) {
      if (typeof arg === "object" && arg) arg = oFormatter(arg, exporter, message);
      format += " " + arg;
    }
    const { maxLength = 10240 } = exporter;
    return format.split(/\r?\n/g).map((line) => {
      return line.slice(0, maxLength) + (line.length > maxLength ? "..." : "");
    }).join("\n");
  }
  constructor(options, service) {
    this.service = service;
    Object.assign(this, options);
    this.error = this._method("error", 0);
    this.info = this._method("info", 1);
    this.warn = this._method("warn", 2);
    this.debug = this._method("debug", 3);
  }
  _method(type, level) {
    return (...args) => {
      if (args.length === 1 && args[0] instanceof Error) {
        if (args[0].cause) this[type](args[0].cause);
        else if (isAggregateError(args[0])) {
          args[0].errors.forEach((error) => this[type](error));
          return;
        }
      }
      const sn = ++this.service._snMessage;
      const ts = Date.now();
      for (const exporter of this.service.exporters.values()) {
        if ((exporter.levels?.[this.name] ?? exporter.levels?.default ?? this.level ?? 1) < level) continue;
        const message = {
          sn,
          ts,
          type,
          level,
          name: this.name,
          ...this.meta,
          args
        };
        exporter.export(message);
      }
    };
  }
};
var c16 = [
  6,
  2,
  3,
  4,
  5,
  1
];
var c256 = [
  20,
  21,
  26,
  27,
  32,
  33,
  38,
  39,
  40,
  41,
  42,
  43,
  44,
  45,
  56,
  57,
  62,
  63,
  68,
  69,
  74,
  75,
  76,
  77,
  78,
  79,
  80,
  81,
  92,
  93,
  98,
  99,
  112,
  113,
  129,
  134,
  135,
  148,
  149,
  160,
  161,
  162,
  163,
  164,
  165,
  166,
  167,
  168,
  169,
  170,
  171,
  172,
  173,
  178,
  179,
  184,
  185,
  196,
  197,
  198,
  199,
  200,
  201,
  202,
  203,
  204,
  205,
  206,
  207,
  208,
  209,
  214,
  215,
  220,
  221
];
var LoggerService = class LoggerService2 {
  bufferSize = 1e3;
  buffer = [];
  ctx;
  _snMessage = 0;
  _snExporter = 0;
  exporters = /* @__PURE__ */ new Map();
  constructor(ctx) {
    const tracker = {
      property: "ctx",
      noShadow: true
    };
    const self = createCallable("logger", joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
    Object.assign(self, this);
    self.ctx = ctx;
    defineProperty(self, symbols.tracker, tracker);
    self.exporter({
      colors: 3,
      export: (message) => {
        self.buffer.push(message);
        if (self.buffer.length > self.bufferSize) self.buffer = self.buffer.slice(-self.bufferSize);
      }
    });
    return self;
  }
  /**
  * Register an exporter and dispose it with the current fiber.
  *
  * @param exporter — the sink that receives structured log messages.
  * @returns a disposer that removes the exporter.
  */
  exporter(exporter) {
    return this.ctx.effect(() => {
      const id = ++this._snExporter;
      this.exporters.set(id, exporter);
      return () => this.exporters.delete(id);
    }, "ctx.logger.exporter()");
  }
  _resolveConfig() {
    let intercept = this.ctx[symbols.intercept];
    const configs = [];
    while ("logger" in intercept) {
      if (Object.hasOwn(intercept, "logger")) configs.unshift(intercept["logger"]);
      intercept = Object.getPrototypeOf(intercept);
    }
    return Object.assign({}, ...configs);
  }
  [symbols.invoke](name) {
    const config = this._resolveConfig();
    const fiber = (this.ctx[symbols.shadow] ?? this.ctx).fiber;
    name ??= config.name;
    name ??= hyphenate(fiber.name);
    return new Logger({
      name,
      level: config.level,
      meta: { fiber: new WeakRef(fiber) }
    }, this);
  }
  static {
    for (const type of [
      "error",
      "info",
      "warn",
      "debug"
    ]) LoggerService2.prototype[type] = function(...args) {
      return this()[type](...args);
    };
  }
};
function enhanceError(error) {
  const lines = error.stack.split("\n");
  lines.splice(0, 2, `Error: ${error.message}`);
  error.stack = lines.join("\n");
  return error;
}
var RESERVED_WORDS = ["prototype", "then"];
function isSpecialProperty(prop) {
  return typeof prop === "symbol" || RESERVED_WORDS.includes(prop) || parseInt(prop).toString() === prop || prop.startsWith("_");
}
var ReflectService = class {
  ctx;
  /** Proxy traps implementing service resolution for every context object. */
  static handler = {
    get: (target, prop, ctx) => {
      if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);
      if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx));
      const error = /* @__PURE__ */ new Error(`cannot get property "${prop}" without inject`);
      try {
        const def = target.reflect.props[prop];
        if (def?.type === "accessor") return def.get.call(ctx, ctx[symbols.receiver], error);
        if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false);
        return ctx.events.waterfall("internal/get", ctx, prop, error, () => {
          const key = target[symbols.isolate][prop];
          let fiber = (ctx[symbols.shadow] ?? ctx).fiber;
          while (true) {
            const impl = fiber.store?.[prop];
            if (impl) return getTraceable(ctx, impl.value);
            if (prop in fiber.inject) {
              error.message = `cannot get required service "${prop}" in inactive context`;
              throw error;
            }
            if (!fiber.runtime) throw error;
            if (fiber.parent[symbols.isolate][prop] !== key) throw error;
            fiber = fiber.parent.fiber;
          }
        });
      } catch (e) {
        throw e === error ? enhanceError(e) : e;
      }
    },
    set: (target, prop, value, ctx) => {
      if (isSpecialProperty(prop)) return Reflect.set(target, prop, value, ctx);
      const error = /* @__PURE__ */ new Error(`cannot set property "${prop}" without provide`);
      const def = target.reflect.props[prop];
      if (!def) {
        if (!ctx.fiber.runtime) return Reflect.set(target, prop, value, ctx);
        throw enhanceError(error);
      }
      try {
        if (def.type === "accessor") {
          if (!def.set) return false;
          return def.set.call(ctx, value, ctx[symbols.receiver], error);
        }
        return ctx.events.waterfall("internal/set", ctx, prop, value, error, () => {
          return ctx.reflect.set(prop, value, error);
        });
      } catch (e) {
        throw e === error ? enhanceError(e) : e;
      }
    },
    has: (target, prop) => {
      if (isSpecialProperty(prop)) return Reflect.has(target, prop);
      if (Reflect.has(target, prop)) return true;
      return !!target.reflect.props[prop];
    }
  };
  /** Service implementations, keyed by isolation label. */
  store = /* @__PURE__ */ Object.create(null);
  /** Declared context properties (services and accessors), by name. */
  props = /* @__PURE__ */ Object.create(null);
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, symbols.tracker, {
      property: "ctx",
      noShadow: true
    });
    this.mixin("reflect", [
      "get",
      "set",
      "provide",
      "accessor",
      "mixin"
    ]);
    this.mixin("fiber", ["runtime", "effect"]);
    this.mixin("registry", ["inject", "plugin"]);
    this.mixin("events", [
      "on",
      "once",
      "parallel",
      "emit",
      "serial",
      "bail",
      "waterfall"
    ]);
  }
  /**
  * Read a service from the store without the inject requirement.
  *
  * @param name — the service name.
  * @param strict — when `true`, only return implementations whose providing
  * fiber is currently active.
  * @returns the service value, or `undefined` when not (yet) provided.
  */
  get(name, strict = true) {
    return getTraceable(this.ctx, this._getImpl(name, strict)?.value);
  }
  _getImpl(name, strict = true) {
    const key = this.ctx[symbols.isolate][name];
    const impl = key && this.store[key];
    if (!impl) return;
    if (strict && impl.fiber.state !== 2) return;
    return impl;
  }
  /**
  * Overwrite a provided service's value.
  *
  * @param name — the service name.
  * @param value — the new service value.
  * @param error — carrier for the caller stack in diagnostics.
  * @returns `true` on success.
  * @throws when `name` was never provided, or was provided by another fiber.
  */
  set(name, value, error) {
    const key = this.ctx[symbols.isolate][name];
    const impl = this.store[key];
    if (!impl) throw new Error(`cannot set property "${name}" without provide`);
    if (impl.fiber !== this.ctx.fiber) throw new Error(`cannot set property "${name}" in multiple fibers`);
    impl.value = value;
    return true;
  }
  /**
  * Register a service implementation owned by the current fiber.
  *
  * See the `ctx.provide()` overload above for the full contract.
  *
  * @param name — the service name.
  * @param value — the service value.
  * @param check — optional availability predicate for dependents.
  * @returns a disposer that unregisters the service.
  */
  provide(name, value, check) {
    return this.ctx.fiber.effect(() => {
      if (!this.props[name]) this.props[name] ??= { type: "service" };
      else if (this.props[name].type !== "service") throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
      this.props[name] = { type: "service" };
      this.ctx.root[symbols.isolate][name] ??= Symbol(name);
      const key = this.ctx[symbols.isolate][name];
      const impl = {
        name,
        value,
        fiber: this.ctx.fiber,
        check
      };
      if (this.store[key]) throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`);
      this.store[key] = impl;
      this.ctx.fiber.store[name] = impl;
      if (this.ctx.fiber.state === 2) this.notify([name]);
      return async () => {
        delete this.store[key];
        const fibers = this.notify([name]);
        await Promise.allSettled(fibers.map((fiber) => fiber.await()));
        delete this.ctx.fiber.store[name];
      };
    }, `ctx.provide(${JSON.stringify(name)})`);
  }
  /**
  * Re-evaluate every fiber that requires one of the given services.
  *
  * @param names — the service names that changed.
  * @param filter — restricts notification to matching isolation scopes.
  * @returns the fibers whose dependency state was refreshed.
  */
  notify(names, filter = (ctx, name) => ctx[symbols.isolate][name] === this.ctx[symbols.isolate][name]) {
    const fibers = [];
    for (const runtime of this.ctx.registry.values()) for (const fiber of runtime.fibers) {
      let hasUpdate = false;
      for (const name of names) {
        if (!(name in fiber.inject)) continue;
        if (!filter(fiber.ctx, name)) continue;
        hasUpdate = true;
        fiber._checkImpl(name);
      }
      if (!hasUpdate) continue;
      fiber._refresh();
      fibers.push(fiber);
    }
    for (const name of names) {
      const self = Object.create(this.ctx);
      self[symbols.filter] = (target) => filter(target, name);
      this.ctx.events.emit(self, "internal/service", name, this._getImpl(name, false)?.value);
    }
    return fibers;
  }
  /**
  * Define a computed context property backed by get/set hooks.
  *
  * @param name — the context property name.
  * @param options — the `get` hook and optional `set` hook.
  * @returns a disposer that removes the accessor.
  */
  accessor(name, options) {
    return this.ctx.fiber.effect(() => {
      if (name in this.props) throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
      this.props[name] = {
        type: "accessor",
        ...options
      };
      return () => delete this.props[name];
    }, `ctx.accessor(${JSON.stringify(name)})`);
  }
  /**
  * Expose selected members of a service directly on `ctx`.
  *
  * See the `ctx.mixin()` overload above for the full contract.
  *
  * @param source — a context property name or a source object.
  * @param mixins — keys to forward, or a source-key → ctx-key map.
  * @returns a disposer that removes all created accessors.
  */
  mixin(source, mixins) {
    const self = this;
    return this.ctx.fiber.effect(function* () {
      const entries = Array.isArray(mixins) ? mixins.map((key) => [key, key]) : Object.entries(mixins);
      const getTarget = (ctx, error) => {
        return ctx[source];
      };
      for (const [key, value] of entries) yield self.accessor(value, {
        get(receiver, error) {
          const service = getTarget(this, error);
          if (isNullable(service)) return service;
          const mixin = receiver ? withProps(receiver, service) : service;
          const value2 = Reflect.get(service, key, mixin);
          if (typeof value2 !== "function") return value2;
          return value2.bind(mixin ?? service);
        },
        set(value2, receiver, error) {
          const service = getTarget(this, error);
          const mixin = receiver ? withProps(receiver, service) : service;
          return Reflect.set(service, key, value2, mixin);
        }
      });
    }, `ctx.mixin(${JSON.stringify(source)})`);
  }
  /**
  * Attach this context's tracing wrapper to a value.
  *
  * @param value — the value to wrap.
  * @returns the traceable wrapper (or the value itself when not applicable).
  */
  trace(value) {
    return getTraceable(this.ctx, value);
  }
  /**
  * Wrap a callback so calls trace `this` and arguments to this context.
  *
  * @param callback — the function to wrap.
  * @returns a proxy delegating to `callback` with traced values.
  */
  bind(callback) {
    return new Proxy(callback, {
      apply: (target, thisArg, args) => {
        return Reflect.apply(target, this.trace(thisArg), args.map((arg) => this.trace(arg)));
      },
      construct: (target, args, newTarget) => {
        return Reflect.construct(target, args.map((arg) => this.trace(arg)), newTarget);
      }
    });
  }
};
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
var ValidationError = class extends TypeError {
  name = "ValidationError";
  /**
  * Build the aggregated message from schema issues.
  *
  * @param issues — the standard-schema issues, one message line each.
  */
  constructor(issues) {
    super(`invalid config:
` + issues.map((issue) => {
      if (issue.path) return `  - ${issue.message} (at ${issue.path.join(".")})`;
      else return `  - ${issue.message}`;
    }).join("\n"));
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
function resolveConfig(runtime, config) {
  if (!runtime.Config) return config;
  const result = runtime.Config["~standard"].validate(config);
  if ("then" in result) throw new TypeError("Async config validation is not supported");
  if (result.issues) throw new ValidationError(result.issues);
  else return result.value;
}
var effectInertia = /* @__PURE__ */ new WeakMap();
function runDisposable(dispose) {
  const result = dispose();
  return effectInertia.get(dispose)?.() ?? result;
}
function emitPluginDisposed(context, fiber) {
  const args = ["internal/plugin", fiber];
  let callbacks;
  try {
    callbacks = context.events.dispatch("emit", args);
  } catch (error) {
    context.logger.error(error);
    return;
  }
  for (const callback of callbacks) try {
    const returned = callback(...args);
    Promise.resolve(returned).catch((error) => context.logger.error(error));
  } catch (error) {
    context.logger.error(error);
  }
}
var CordisError = class CordisError2 extends Error {
  code;
  /**
  * @param code — the stable error code; also the default message.
  * @param message — optional human-readable override.
  */
  constructor(code, message) {
    super(message ?? CordisError2.Code[code]);
    this.code = code;
  }
};
(function(CordisError3) {
  CordisError3.Code = { INACTIVE_EFFECT: "cannot create effect on inactive context" };
})(CordisError || (CordisError = {}));
var INACTIVE = "__INACTIVE__";
var Fiber = class {
  parent;
  inject;
  runtime;
  /** Unique id within the registry; 0 for the root fiber, `null` once disposed. */
  uid;
  /** The context this fiber's plugin runs in (extends the parent context). */
  ctx;
  /** The validated plugin config (updated by `update()`). */
  config;
  /** The raw plugin config, re-resolved before each activation. */
  _config;
  /** Current lifecycle state; transitions emit `internal/status`. */
  state = 0;
  /** Dispose this fiber: unload the plugin, then settle once cleanup finished. */
  dispose;
  /** Snapshot of required service implementations while loaded; `undefined` otherwise. */
  store;
  /** The in-flight load/unload transition, if one is currently running. */
  inertia;
  _hooks = /* @__PURE__ */ Object.create(null);
  _disposables = new DisposableList();
  context;
  _error;
  _runner;
  _store = /* @__PURE__ */ Object.create(null);
  /**
  * Create a fiber. Plugin authors normally obtain fibers from `ctx.plugin()`
  * rather than constructing them directly.
  *
  * @param parent — the context the plugin was loaded from.
  * @param config — raw config, validated against the runtime's schema.
  * @param inject — resolved dependency map (service name → intercept config).
  * @param runtime — the shared plugin runtime, or `null` for the root fiber.
  * @param getOuterStack — captures the caller stack for effect diagnostics.
  */
  constructor(parent, config, inject2, runtime, getOuterStack) {
    this.parent = parent;
    this.inject = inject2;
    this.runtime = runtime;
    this._config = config;
    const collect = (dispose) => {
      this._disposables.push(dispose);
    };
    if (runtime) {
      this.uid = parent.registry.counter;
      this.ctx = this.context = parent.extend({ fiber: this });
      const injectEntries = Object.entries(this.inject);
      if (injectEntries.length) {
        this.ctx[Context.intercept] = Object.create(parent[Context.intercept]);
        for (const [name, config2] of injectEntries) {
          if (isNullable(config2)) continue;
          this.ctx[Context.intercept][name] = config2;
        }
      }
      this._runner = {
        epoch: INACTIVE,
        getOuterStack,
        execute: function() {
          if (isConstructor(runtime.callback)) {
            const instance = new runtime.callback(this.ctx, this.config);
            for (const hook of instance?.[symbols.initHooks] ?? []) hook();
            return instance?.[symbols.init]?.();
          } else return runtime.callback(this.ctx, this.config);
        },
        collect
      };
      this.dispose = parent.fiber.effect(() => {
        const remove = runtime.fibers.push(this);
        return async () => {
          this.uid = null;
          emitPluginDisposed(this.context, this);
          if (this.ctx.registry.has(runtime.callback)) {
            remove();
            if (!runtime.fibers.length) this.ctx.registry.delete(runtime.callback);
          }
          this._setEpoch(INACTIVE);
          if (!this.inertia) this._updateState(() => {
            this.inertia = this._unload();
            return 5;
          });
          while (this.inertia) await this.inertia;
        };
      }, "ctx.plugin()");
      try {
        this.context.emit("internal/plugin", this);
      } catch (error) {
        Promise.resolve(this.dispose()).catch((reason) => this.ctx.logger.error(reason));
        throw error;
      }
      if (this.uid !== null && parent.fiber.state !== 5) {
        for (const name of Object.keys(this.inject)) this._checkImpl(name);
        this._refresh();
      }
    } else {
      this.uid = 0;
      this.ctx = this.context = parent;
      this.state = 2;
      this.store = /* @__PURE__ */ Object.create(null);
      this._runner = {
        epoch: "",
        getOuterStack,
        execute: () => {
        },
        collect
      };
      this.dispose = () => this.restart();
    }
  }
  /** The plugin's display name, inherited from the nearest named ancestor, else `'root'`. */
  get name() {
    let fiber = this;
    do {
      if (fiber.runtime?.name) return fiber.runtime.name;
      fiber = fiber.parent.fiber;
    } while (fiber !== fiber.parent.fiber);
    return "root";
  }
  /**
  * Throw if the fiber has already been disposed.
  *
  * @returns nothing when the fiber is still active.
  * @throws {CordisError} `INACTIVE_EFFECT` when the fiber's uid has been cleared.
  */
  assertActive() {
    if (this.uid !== null) return;
    throw new CordisError("INACTIVE_EFFECT");
  }
  _execute(runner) {
    const oldEpoch = runner.epoch;
    return composeError((info) => {
      const safeCollect = (dispose) => {
        if (typeof dispose === "function") runner.collect(dispose);
        else if (!isNullable(dispose)) throw new TypeError("Invalid effect");
      };
      const effect = runner.execute.call(this);
      if (typeof effect === "function") return runner.collect(effect);
      else if (isNullable(effect)) {
      } else if (!isObject(effect)) throw new TypeError("Invalid effect");
      else if ("then" in effect) return effect.then(safeCollect);
      else if (Symbol.iterator in effect) {
        info.error = /* @__PURE__ */ new Error();
        const iter = effect[Symbol.iterator]();
        while (true) {
          const result = iter.next();
          safeCollect(result.value);
          if (result.done) return;
        }
      } else if (Symbol.asyncIterator in effect) {
        const iter = effect[Symbol.asyncIterator]();
        return (async () => {
          await Promise.resolve();
          info.error = /* @__PURE__ */ new Error();
          while (true) {
            if (runner.epoch !== oldEpoch) return;
            const result = await iter.next();
            safeCollect(result.value);
            if (result.done) return;
          }
        })();
      } else throw new TypeError("Invalid effect");
    }, runner.getOuterStack);
  }
  effect(execute, label = "anonymous") {
    this.assertActive();
    if (this.state === 5) throw new CordisError("INACTIVE_EFFECT");
    const disposables = [];
    let disposing = false;
    let disposalTask;
    const dispose = () => {
      if (disposing) return disposalTask;
      disposing = true;
      let task2;
      for (const disposable of disposables.splice(0).reverse()) if (task2) task2 = task2.then(() => runDisposable(disposable));
      else {
        const result = runDisposable(disposable);
        if (isObject(result) && "then" in result) task2 = result;
      }
      return disposalTask = task2;
    };
    const meta = {
      label,
      children: []
    };
    const runner = {
      execute,
      epoch: true,
      collect: (dispose2) => {
        disposables.push(dispose2);
        this._disposables.delete(dispose2);
        if (dispose2[symbols.effect]) meta.children.push(dispose2[symbols.effect]);
      },
      getOuterStack: buildOuterStack()
    };
    let task;
    let executing = true;
    let resolveSetup;
    let rejectSetup;
    let setupBarrier;
    let setupFailed = false;
    let inFlight;
    let removeWrapper = () => false;
    const waitForSetup = () => {
      setupBarrier ??= new Promise((resolve2, reject) => {
        resolveSetup = resolve2;
        rejectSetup = reject;
      });
      return setupBarrier;
    };
    const disposeAfter = (setup) => {
      return Promise.resolve(setup).then(() => dispose(), async (reason) => {
        await dispose();
        throw reason;
      });
    };
    const finalizeDisposal = (callback) => {
      let result;
      try {
        result = callback();
      } catch (error) {
        removeWrapper();
        throw error;
      }
      if (isObject(result) && "then" in result) {
        const pending = Promise.resolve(result).finally(() => {
          removeWrapper();
          if (inFlight === pending) inFlight = void 0;
        });
        return inFlight = pending;
      }
      removeWrapper();
      return result;
    };
    const wrapper = defineProperty(() => {
      if (!runner.epoch) return setupFailed ? inFlight : void 0;
      runner.epoch = false;
      return finalizeDisposal(() => {
        if (executing) return disposeAfter(waitForSetup());
        return task ? disposeAfter(task) : dispose();
      });
    }, symbols.effect, meta);
    effectInertia.set(wrapper, () => inFlight);
    removeWrapper = this._disposables.push(wrapper);
    try {
      task = this._execute(runner);
    } catch (reason) {
      executing = false;
      setupFailed = true;
      runner.epoch = false;
      let cleanup;
      try {
        cleanup = finalizeDisposal(dispose);
      } finally {
        rejectSetup?.(reason);
      }
      if (isObject(cleanup) && "then" in cleanup) cleanup.catch((error) => this.ctx.logger.error(error));
      throw reason;
    }
    executing = false;
    if (setupBarrier) Promise.resolve(task).then(resolveSetup, rejectSetup);
    task?.catch(() => {
      if (!runner.epoch) return dispose();
      return finalizeDisposal(dispose);
    }).catch((error) => this.ctx.logger.error(error));
    const disposeAsync = () => {
      if (!runner.epoch) return;
      runner.epoch = false;
      return finalizeDisposal(dispose);
    };
    wrapper.then = async (onFulfilled, onRejected) => {
      return Promise.resolve(task).then(() => disposeAsync).then(onFulfilled, onRejected);
    };
    return wrapper;
  }
  /**
  * Return metadata for currently registered effects.
  *
  * @returns one {@link EffectMeta} tree per labeled live effect.
  */
  getEffects() {
    return [...this._disposables].map((dispose) => dispose[symbols.effect]).filter(Boolean);
  }
  _getState() {
    if (this.uid === null) return 4;
    if (this._error) return 3;
    if (this._runner.epoch !== INACTIVE) return 2;
    return 0;
  }
  _updateState(callback) {
    const oldState = this.state;
    this.state = callback() ?? this._getState();
    if (oldState === this.state) return;
    this.context.emit("internal/status", this, oldState);
    if (oldState !== 2 && this.state !== 2) return;
    for (const key of Reflect.ownKeys(this.ctx.reflect.store)) {
      const impl = this.ctx.reflect.store[key];
      if (impl.fiber !== this) continue;
      this.ctx.reflect.notify([impl.name]);
    }
  }
  _checkImpl(name) {
    const impl = this.ctx.reflect._getImpl(name, true);
    if (!impl) return delete this._store[name];
    try {
      if (impl.check && !impl.check.call(getTraceable(this.ctx, impl.value))) return delete this._store[name];
    } catch (error) {
      impl.fiber.ctx.logger.error(error);
      return delete this._store[name];
    }
    this._store[name] = impl;
  }
  _refresh() {
    let epoch = false;
    epoch = "";
    for (const name of Object.keys(this.inject)) {
      const impl = this._store[name];
      if (!impl) {
        epoch = INACTIVE;
        break;
      }
      epoch += ":" + impl.fiber.uid;
    }
    this._setEpoch(epoch);
  }
  _setEpoch(epoch) {
    const oldEpoch = this._runner.epoch;
    if (epoch === oldEpoch) return;
    this._runner.epoch = epoch;
    if (this.inertia) return;
    this._updateState(() => {
      if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
        this.inertia = this._reload();
        return 1;
      } else {
        this.inertia = this._unload();
        return 5;
      }
    });
  }
  _resolveConfig(config) {
    config = this.context.waterfall(this, "internal/config", config, () => config);
    return this.runtime ? resolveConfig(this.runtime, config) : config;
  }
  async _reload() {
    this.store = { ...this._store };
    const oldEpoch = this._runner.epoch;
    try {
      await Promise.resolve();
      if (this._runner.epoch === oldEpoch) {
        this.config = this._resolveConfig(this._config);
        await this._execute(this._runner);
        this._error = void 0;
      }
    } catch (reason) {
      this.ctx.logger.error(reason);
      this._error = reason;
      this._runner.epoch = INACTIVE;
    }
    this._updateState(() => {
      if (this._runner.epoch === oldEpoch) this.inertia = void 0;
      else {
        this.inertia = this._unload();
        return 5;
      }
    });
  }
  async _unload() {
    await Promise.all(this._disposables.clear().map(async (dispose) => {
      try {
        await composeError(async (info) => {
          await Promise.resolve();
          info.error = /* @__PURE__ */ new Error();
          await runDisposable(dispose);
        }, this._runner.getOuterStack);
      } catch (reason) {
        this.ctx.logger.error(reason);
      }
    }));
    this.store = void 0;
    this._updateState(() => {
      if (this._runner.epoch === INACTIVE) this.inertia = void 0;
      else {
        this.inertia = this._reload();
        return 1;
      }
    });
  }
  /**
  * Wait for current lifecycle work and rethrow startup errors.
  *
  * @returns this fiber, once it has settled into a stable state.
  * @throws the config-validation or plugin-startup error, if any.
  */
  async await() {
    while (this.inertia) await this.inertia;
    if (this._error) throw this._error;
    return this;
  }
  /**
  * Dispose and immediately reload this plugin with its current config.
  *
  * @returns a promise resolving once the reload settled.
  * @throws {CordisError} `INACTIVE_EFFECT` when the fiber is already disposed.
  */
  async restart() {
    this.assertActive();
    this._setEpoch(INACTIVE);
    this._refresh();
    await this.await();
  }
  /**
  * Validate and apply new config, then restart the plugin.
  *
  * Runs the `internal/update` waterfall first, so update hooks (and HMR)
  * can veto or replace the restart.
  *
  * @param config — the new raw config; validated before anything restarts.
  * @param noSave — hint for persistence hooks not to write the change back.
  * @returns nothing; the restart runs behind the `internal/update` waterfall.
  * @throws {ValidationError} when the new config fails validation.
  */
  update(config, noSave = false) {
    this.assertActive();
    this._config = config;
    if (this.state !== 2) {
      this._error = void 0;
      this._setEpoch(INACTIVE);
      this._refresh();
      return;
    }
    config = this._resolveConfig(config);
    this.context.waterfall(this, "internal/update", config, noSave, () => {
      this.config = config;
      this._error = void 0;
      return this.restart();
    });
  }
};
function isApplicable(object) {
  return object && typeof object === "object" && typeof object.apply === "function";
}
function Inject(name, config) {
  return function(value, decorator) {
    if (decorator.kind === "class") {
      if (!Object.hasOwn(value, "inject")) {
        defineProperty(value, "inject", Object.create(Object.getPrototypeOf(value).inject ?? null));
        defineProperty(value.inject, symbols.checkProto, true);
      }
      value.inject[name] = config;
    } else if (decorator.kind === "method") {
      const inject2 = (value[symbols.metadata] ??= {}).inject ??= /* @__PURE__ */ Object.create(null);
      inject2[name] = config;
      decorator.addInitializer(function() {
        const property2 = this[symbols.tracker]?.property;
        (this[symbols.initHooks] ??= []).push(() => {
          this.ctx.inject(inject2, (ctx) => {
            return value.call(property2 ? withProps(this, { [property2]: ctx }) : this);
          });
        });
      });
    } else throw new Error("@Inject() can only be used on class or class methods");
  };
}
(function(Inject2) {
  function resolve2(inject2, result = /* @__PURE__ */ Object.create(null)) {
    if (!inject2) return result;
    if (Array.isArray(inject2)) for (const name of inject2) result[name] = null;
    else if (Reflect.has(inject2, symbols.checkProto)) {
      Object.assign(result, resolve2(Object.getPrototypeOf(inject2)));
      for (const name of Object.keys(inject2)) result[name] = inject2[name] ?? null;
    } else for (const name of Object.keys(inject2)) result[name] = inject2[name] ?? null;
    return result;
  }
  Inject2.resolve = resolve2;
})(Inject || (Inject = {}));
var RegistryService = class {
  ctx;
  _counter = 0;
  _internal = /* @__PURE__ */ new Map();
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, symbols.tracker, {
      property: "ctx",
      noShadow: true
    });
  }
  /** Allocate the next fiber uid (increments on every read). */
  get counter() {
    return ++this._counter;
  }
  /** Number of registered plugin runtimes. */
  get size() {
    return this._internal.size;
  }
  /**
  * Resolve a supported plugin shape to its executable callback.
  *
  * @param plugin — a function, class, or `{ apply }` object plugin.
  * @returns the callback identifying the plugin, or `undefined` if invalid.
  */
  resolve(plugin) {
    try {
      if (typeof plugin === "function") return plugin;
      if (isApplicable(plugin)) return plugin.apply;
    } catch {
    }
  }
  /**
  * Look up the runtime record for a plugin.
  *
  * @param plugin — any supported plugin shape.
  * @returns the runtime, or `undefined` when the plugin is not registered.
  */
  get(plugin) {
    const key = this.resolve(plugin);
    return key && this._internal.get(key);
  }
  /**
  * Check whether a plugin has a registered runtime.
  *
  * @param plugin — any supported plugin shape.
  * @returns `true` when at least one fiber of the plugin exists.
  */
  has(plugin) {
    const key = this.resolve(plugin);
    return !!key && this._internal.has(key);
  }
  /**
  * Dispose every running fiber for a plugin and remove its runtime record.
  *
  * @param plugin — any supported plugin shape.
  * @returns the removed runtime, or `undefined` when none was registered.
  */
  delete(plugin) {
    const key = this.resolve(plugin);
    const runtime = key && this._internal.get(key);
    if (!runtime) return;
    this._internal.delete(key);
    for (const fiber of runtime.fibers) fiber.dispose();
    return runtime;
  }
  /** Iterate the registered plugin callbacks. */
  keys() {
    return this._internal.keys();
  }
  /** Iterate the registered plugin runtimes. */
  values() {
    return this._internal.values();
  }
  /** Iterate `[callback, runtime]` pairs. */
  entries() {
    return this._internal.entries();
  }
  /**
  * Visit every registered runtime.
  *
  * @param callback — receives each runtime and its identifying callback.
  */
  forEach(callback) {
    return this._internal.forEach(callback);
  }
  /**
  * Start a callback once the requested dependencies are available.
  *
  * @param inject — required services, as an array or a name → config map.
  * @param callback — plugin body called with `(ctx, config)`.
  * @returns the fiber; awaiting it settles once loading finished.
  */
  inject(inject2, callback) {
    return this.plugin({
      inject: inject2,
      apply: callback,
      name: callback.name
    });
  }
  /**
  * Start a plugin in the current context and return its fiber.
  *
  * Creates (or reuses) the plugin's runtime record, then starts a new fiber
  * under the current context. Throws if `plugin` is not a supported shape or
  * if the current fiber is already disposed.
  *
  * @param plugin — a function, class, or `{ apply }` object plugin.
  * @param config — the plugin config, validated against its `Config` schema.
  * @param getOuterStack — captures the caller stack for effect diagnostics.
  * @returns the fiber; awaiting it settles once loading finished.
  */
  plugin(plugin, config, getOuterStack = buildOuterStack()) {
    const callback = this.resolve(plugin);
    if (!callback) throw new Error('invalid plugin, expect function or object with an "apply" method, received ' + typeof plugin);
    this.ctx.fiber.assertActive();
    let runtime = this._internal.get(callback);
    if (!runtime) {
      let name = plugin.name;
      if (name === "apply") name = void 0;
      runtime = {
        name,
        callback,
        fibers: new DisposableList(),
        Config: plugin.Config
      };
      this._internal.set(callback, runtime);
    }
    const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack);
    const wrapped = Object.create(fiber);
    wrapped.then = (onFulfilled, onRejected) => {
      return fiber.await().then(onFulfilled, onRejected);
    };
    return wrapped;
  }
};
var Context = class Context2 {
  /** Symbol key under which a disposer exposes its {@link EffectMeta} diagnostics tree. */
  static effect = symbols.effect;
  /** Symbol key for a context's listener filter, consulted on every event dispatch. */
  static filter = symbols.filter;
  /** Symbol key of the isolation map (see the `Context[symbols.isolate]` property). */
  static isolate = symbols.isolate;
  /** Symbol key of the intercept map (see the `Context[symbols.intercept]` property). */
  static intercept = symbols.intercept;
  /**
  * Returns true for Cordis context proxies and context prototypes.
  *
  * Works across realms and across multiple copies of cordis, because the
  * brand is keyed by a global symbol rather than by `instanceof`.
  *
  * @param value — the value to test.
  * @returns `true` if `value` is a Cordis context, narrowing its type.
  */
  static is(value) {
    return !!value?.[Context2.is];
  }
  static {
    Context2.is[Symbol.toPrimitive] = () => /* @__PURE__ */ Symbol.for("cordis.is");
    Context2.prototype[Context2.is] = true;
  }
  /** Create the root context and install the built-in services. */
  constructor() {
    this[symbols.isolate] = /* @__PURE__ */ Object.create(null);
    this[symbols.intercept] = /* @__PURE__ */ Object.create(null);
    const self = new Proxy(this, ReflectService.handler);
    this.root = self;
    this.baseUrl = void 0;
    this.fiber = new Fiber(self, {}, /* @__PURE__ */ Object.create(null), null, () => []);
    this.reflect = new ReflectService(self);
    this.registry = new RegistryService(self);
    this.events = new EventsService(self);
    this.logger = new LoggerService(self);
    this.fiber._disposables.clear();
    return self;
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return `Context <${this.fiber.name}>`;
  }
  /**
  * Create a child context with extra metadata on top of the current scope.
  *
  * The child prototypally inherits every property of this context; own
  * properties of `meta` shadow the inherited ones. The parent is not mutated.
  *
  * @param meta — own properties (including symbol keys) to define on the child.
  * @returns a child context inheriting from this one.
  */
  extend(meta = {}) {
    const shadow = Reflect.getOwnPropertyDescriptor(this, symbols.shadow)?.value;
    const self = Object.create(getTraceable(this, this));
    for (const prop of Reflect.ownKeys(meta)) Object.defineProperty(self, prop, Reflect.getOwnPropertyDescriptor(meta, prop));
    if (!shadow) return self;
    return Object.assign(Object.create(self), { [symbols.shadow]: shadow });
  }
  /**
  * Create a child context with an independent service scope for `name`.
  *
  * Below the returned context, reads and writes of the service `name`
  * resolve against the new label instead of the parent's, so a different
  * implementation can be provided without affecting the parent scope.
  * Passing the same `label` to two `isolate()` calls joins their scopes.
  *
  * @param name — the service name to isolate.
  * @param label — scope label to join; defaults to a fresh unique symbol.
  * @returns a child context whose `name` service resolves in the new scope.
  */
  isolate(name, label) {
    const shadow = Object.create(this[symbols.isolate]);
    shadow[name] = label ?? Symbol(name);
    return this.extend({ [symbols.isolate]: shadow });
  }
  intercept(name, config) {
    const intercept = Object.create(this[symbols.intercept]);
    intercept[name] = config;
    return this.extend({ [symbols.intercept]: intercept });
  }
};
var Service = class Service2 {
  ctx;
  /** Symbol key of an instance method run after construction (class plugins). */
  static init = symbols.init;
  /** Symbol key of the availability predicate passed to `ctx.provide()`. */
  static check = symbols.check;
  /** Symbol key of the phantom intercept-config type parameter. */
  static config = symbols.config;
  /** Symbol key of the call body making a service callable (e.g. `ctx.logger()`). */
  static invoke = symbols.invoke;
  /** Symbol key of the helper deriving an extended service instance. */
  static extend = symbols.extend;
  /** Symbol key of the tracker metadata used for context tracing. */
  static tracker = symbols.tracker;
  /** Symbol key of the intercept-config resolution helper below. */
  static resolveConfig = symbols.resolveConfig;
  /** The service name this instance is registered under. */
  name;
  /**
  * Register this instance as `name` in the current context.
  *
  * Calls `ctx.reflect.provide(name, this, this[Service.check])`, so the
  * service is unregistered automatically when the owning fiber unloads.
  * Services with a `[Service.invoke]` body return a callable instance.
  *
  * @param ctx — the context to register in (stored as `this.ctx`).
  * @param name — the service name; defaults to the static `provide` field.
  */
  constructor(ctx, name) {
    this.ctx = ctx;
    name ??= this.constructor["provide"];
    let self = this;
    const tracker = {
      associate: name,
      property: "ctx"
    };
    if (self[symbols.invoke]) self = createCallable(name, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
    self.ctx = ctx;
    self.name = name;
    defineProperty(self, symbols.tracker, tracker);
    self.ctx.reflect.provide(name, self, this[symbols.check]);
    return self;
  }
  [symbols.filter](ctx) {
    return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name];
  }
  [symbols.extend](props) {
    let self;
    if (this[Service2.invoke]) self = createCallable(this.name, this, this[symbols.tracker]);
    else self = Object.create(this);
    return Object.assign(self, props);
  }
  /**
  * Merge intercept config from ancestors with optional base and head values.
  *
  * Entries added closer to the root apply first; `base` is prepended and
  * `head` appended. Uses `Config.merge` when the service declares one,
  * otherwise a shallow `Object.assign`.
  *
  * @param base — lowest-precedence config merged before all intercepts.
  * @param head — highest-precedence config merged after all intercepts.
  * @returns the merged config.
  */
  [symbols.resolveConfig](base, head) {
    let intercept = this.ctx[Context.intercept];
    const configs = [];
    while (this.name in intercept) {
      if (Object.hasOwn(intercept, this.name)) configs.unshift(intercept[this.name]);
      intercept = Object.getPrototypeOf(intercept);
    }
    if (base) configs.unshift(base);
    if (head) configs.push(head);
    if (this["Config"]?.merge) return this["Config"].merge(...configs);
    else return Object.assign({}, ...configs);
  }
  static [Symbol.hasInstance](instance) {
    if (!instance) return false;
    let constructor = instance.constructor;
    while (constructor) {
      constructor = constructor.prototype?.constructor;
      if (constructor === this) return true;
      constructor &&= Object.getPrototypeOf(constructor);
    }
    return false;
  }
};

// node_modules/@deepseek-ai/dsh-brand/lib/index.js
function brandString(value) {
  return value;
}

// node_modules/@deepseek-ai/dsh-credentials/lib/index.js
var REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
function credentialRef(value) {
  if (!isCredentialRefName(value)) throw new TypeError(`credential ref "${value}" must match ${String(REF_PATTERN)}`);
  return brandString(value);
}
function isCredentialRefName(value) {
  return REF_PATTERN.test(value);
}

// src/chat-proxy.ts
var UpstreamError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "UpstreamError";
  }
  status;
};
var UnconfiguredError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UnconfiguredError";
  }
};
function resolveChatProxyConfig(env, config) {
  const apiKey = config?.apiKey ?? env.apiKey ?? "";
  if (apiKey.trim() === "") return null;
  return {
    apiKey: apiKey.trim(),
    baseUrl: (config?.baseUrl ?? env.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, ""),
    model: config?.model ?? env.model ?? "deepseek-chat"
  };
}
async function forwardChat(config, messages, modelOverride) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 6e4);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: modelOverride ?? config.model,
        messages,
        stream: false,
        max_tokens: 300
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        detail = "";
      }
      throw new UpstreamError(`upstream ${res.status}: ${detail.slice(0, 300)}`, res.status);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new UpstreamError("upstream returned an empty completion", 502);
    }
    return { content };
  } finally {
    clearTimeout(timer);
  }
}
function directBackend(resolve2) {
  const catalog = (config) => ({
    providers: [
      {
        id: "direct",
        name: "\u76F4\u8FDE",
        models: [
          {
            id: config.model,
            name: config.model,
            efforts: []
          }
        ]
      }
    ],
    default: { provider: "direct", model: config.model }
  });
  return {
    async available() {
      return await resolve2() !== null;
    },
    async listModels() {
      const config = await resolve2();
      if (config === null) throw new UnconfiguredError(
        "whale-pet chat: no API key configured (set DSH_WHALE_API_KEY / DEEPSEEK_API_KEY env or plugin config.apiKey)"
      );
      return catalog(config);
    },
    async chat(messages, options) {
      const config = await resolve2();
      if (config === null) throw new UnconfiguredError(
        "whale-pet chat: no API key configured (set DSH_WHALE_API_KEY / DEEPSEEK_API_KEY env or plugin config.apiKey)"
      );
      return forwardChat(config, messages, options?.model ?? config.model);
    },
    async *streamChat(messages, options) {
      const { content } = await this.chat(messages, options);
      if (content !== "") yield content;
    }
  };
}
var PROXY_MAX_BODY_BYTES = 64 * 1024;
async function readJsonBody(req, limit = PROXY_MAX_BODY_BYTES) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) return null;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) return null;
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}
function createChatProxyHandler(backend) {
  return async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/api/whale-pet/health") {
      let configured = false;
      try {
        configured = await backend.available();
      } catch {
        configured = false;
      }
      sendJson(res, 200, { ok: true, configured });
      return;
    }
    if (pathname === "/api/whale-pet/models") {
      if ((req.method ?? "GET").toUpperCase() !== "GET") {
        sendJson(res, 405, { error: "method not allowed" });
        return;
      }
      try {
        sendJson(res, 200, await backend.listModels());
      } catch (error) {
        sendJson(res, 503, { error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
      }
      return;
    }
    if (pathname !== "/api/whale-pet/chat") {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      body = null;
    }
    if (body === null || typeof body !== "object" || !Array.isArray(body.messages) || body.messages.length === 0) {
      sendJson(res, 400, { error: "request body must be JSON: { messages: [{ role, content }], provider?, model?, effort? }" });
      return;
    }
    const record = body;
    const options = {
      ...typeof record.provider === "string" ? { provider: record.provider } : {},
      ...typeof record.model === "string" ? { model: record.model } : {},
      ...typeof record.effort === "string" ? { effort: record.effort } : {}
    };
    const accept = String(req.headers.accept ?? "");
    const wantsStream = accept.includes("text/event-stream") && backend.streamChat !== void 0;
    try {
      if (wantsStream) {
        await writeChatSse(res, backend.streamChat(record.messages, options));
        return;
      }
      const { content } = await backend.chat(record.messages, options);
      sendJson(res, 200, { ok: true, content });
    } catch (error) {
      if (error instanceof UnconfiguredError) {
        sendJson(res, 503, { ok: false, status: 503, error: error.message });
        return;
      }
      const status = error instanceof UpstreamError ? error.status : 502;
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, status, { ok: false, status, error: message.slice(0, 300) });
    }
  };
}
async function writeChatSse(res, deltas) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive"
  });
  try {
    for await (const delta of deltas) {
      if (delta === "") continue;
      res.write(`data: ${JSON.stringify({ delta })}

`);
    }
    res.write('data: {"done":true}\n\n');
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
    res.write(`data: ${JSON.stringify({ error: message })}

`);
    res.end();
  }
}

// node_modules/@deepseek-ai/dsh-llm/lib/index.js
import { createRequire } from "node:module";

// node_modules/@deepseek-ai/dsh-typert-protocol/lib/index.js
var RemoteError = class extends Error {
  code;
  details;
  /** Structural marker: cross-realm/bundle identification never uses instanceof. */
  isDSHRemoteError = true;
  /**
  * @param code - stable failure code declared in {@link RemoteErrorDetailsMap}.
  * @param message - human diagnostic carried across the wire.
  * @param details - structured payload typed by the code.
  * @param options - standard Error options (`cause` survives in-process only).
  */
  constructor(code, message, details, options) {
    super(message, options);
    this.code = code;
    this.details = details;
    this.name = "RemoteError";
  }
};
var TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
function isTypertRemoteSegment(value) {
  return value !== "." && value !== ".." && TYPERT_REMOTE_SEGMENT_PATTERN.test(value);
}
var REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";
function bindTypertRemote(service, serviceKey, options = {}) {
  validateName("service key", serviceKey);
  const namespace = options.namespace ?? serviceKey;
  validateName("namespace", namespace);
  const ctx = Reflect.get(service, "ctx");
  if (ctx instanceof Context) provideInvocationAccessor(ctx);
  return Object.freeze({
    service,
    serviceKey,
    namespace
  });
}
var TypertRemoteService = class extends Service {
  /** Visible binding consumed by the Gateway's source-mode discovery. */
  typertRemote;
  /**
  * Register the Service and bind the same key to Typert Gateway.
  * @param ctx - owning Cordis Context.
  * @param serviceKey - exact Cordis service key and default wire namespace.
  * @param options - optional distinct wire namespace.
  */
  constructor(ctx, serviceKey, options = {}) {
    super(ctx, serviceKey);
    this.typertRemote = bindTypertRemote(this, this.name, options);
  }
};
function provideInvocationAccessor(ctx) {
  if (Object.hasOwn(ctx.root.reflect.props, "invocation")) return;
  ctx.root.accessor("invocation", { get: () => void 0 });
}
function Remote(methodExportOrOptions, context) {
  if (typeof methodExportOrOptions === "string") {
    validateName("Remote export name", methodExportOrOptions);
    return remoteDecorator({ kind: "direct" }, void 0, methodExportOrOptions);
  }
  if (typeof methodExportOrOptions === "object") {
    if (remoteOptionMode(methodExportOrOptions) !== "stream" || Reflect.ownKeys(methodExportOrOptions).length !== 1) throw new TypeError('typert-protocol: Remote options must contain exactly mode: "stream"');
    return remoteDecorator({ kind: "direct" }, "stream");
  }
  if (context === void 0) throw new TypeError("typert-protocol: Remote decorator context is missing");
  addMarkerInitializer(context, { kind: "direct" });
}
function remoteOptionMode(options) {
  return Reflect.get(options, "mode");
}
function remoteDecorator(invocation, mode, exportName) {
  return function(_method, context) {
    addMarkerInitializer(context, invocation, mode, exportName);
  };
}
function readRemoteMethodDescriptor(prototype) {
  const property2 = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR);
  if (property2 === void 0) return void 0;
  const descriptor = property2.value;
  if (descriptor === null || typeof descriptor !== "object") throw new TypeError("typert-protocol: Remote method descriptor must be an object");
  const version2 = Reflect.get(descriptor, "version");
  if (version2 !== 1) throw new TypeError(`typert-protocol: unsupported Remote method descriptor version ${String(version2)}`);
  const methods = Reflect.get(descriptor, "methods");
  if (!Array.isArray(methods)) throw new TypeError("typert-protocol: Remote method descriptor methods must be an array");
  return descriptor;
}
function addMarkerInitializer(context, invocation, mode, exportName) {
  if (context.private || context.static || typeof context.name !== "string") throw new TypeError("typert-protocol: Remote decorators require a public instance method with a string name");
  const method = context.name;
  context.addInitializer(function() {
    const prototype = Object.getPrototypeOf(this);
    if (prototype === null) throw new TypeError(`typert-protocol: cannot mark Remote method "${method}" on an object without a prototype`);
    mark(prototype, method, invocation, mode, exportName);
  });
}
function mark(prototype, method, invocation, mode, exportName) {
  const descriptor = readRemoteMethodDescriptor(prototype);
  const marker = Object.freeze({
    method,
    ...exportName === void 0 || exportName === method ? {} : { exportName },
    ...mode === void 0 ? {} : { mode },
    invocation: Object.freeze(invocation)
  });
  const current = descriptor?.methods.find((candidate) => candidate.method === method);
  if (current !== void 0) {
    if (current.exportName === marker.exportName && current.mode === marker.mode && sameInvocation(current.invocation, invocation)) return;
    throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`);
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...descriptor?.methods ?? [], marker])
    })
  });
}
function sameInvocation(left, right) {
  if (left.kind === "direct") return right.kind === "direct";
  if (right.kind === "direct") return false;
  return left.context === right.context;
}
function validateName(subject, value) {
  if (!isTypertRemoteSegment(value)) throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`);
}

// node_modules/@deepseek-ai/dsh-util-values/lib/index.js
function assertNever(value, context) {
  const rendered = JSON.stringify(value) ?? String(value);
  throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
function deepFreeze(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const pending = [{
    kind: "visit",
    node: value
  }];
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === void 0) continue;
    if (task.kind === "property") {
      pending.push({
        kind: "visit",
        node: task.source[task.key]
      });
      continue;
    }
    const node = task.node;
    if (node === null || typeof node !== "object") continue;
    if (node instanceof AbortSignal) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    Object.freeze(node);
    const keys = Object.keys(node);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === void 0) continue;
      pending.push({
        kind: "property",
        source: node,
        key
      });
    }
  }
  return value;
}

// node_modules/@deepseek-ai/dsh-util-crypto/lib/index.js
function randomUUID() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte, index) => {
    return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = /* @__PURE__ */ Symbol.for("schemastery");
var kValidationError2 = /* @__PURE__ */ Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError2 = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError2];
  }
};
Object.defineProperty(ValidationError2.prototype, kValidationError2, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError2.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError2;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (isVolatile(value)) value = value.get();
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.volatile = function volatile() {
  if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
  return this.extra("volatile", true);
};
var resolvers = {};
var checkedVolatile = /* @__PURE__ */ Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
  const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
  if (states.has(blocked)) return;
  states.add(blocked);
  seen.set(schema, states);
  if (schema.meta?.volatile && blocked) throw new ValidationError2("volatile fields require a fixed object path without an enclosing volatile field", { path });
  const nested = blocked || !!schema.meta?.volatile;
  if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
  if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
  if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
  if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve2) {
  resolvers[type] = resolve2;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (!options[checkedVolatile]) {
    validateVolatileSchema(schema, options.path);
    options = {
      ...options,
      [checkedVolatile]: true
    };
  }
  if (schema.meta?.volatile) {
    const inner = Schema(schema);
    inner.meta = {
      ...schema.meta,
      volatile: false
    };
    const [value, adapted] = Schema.resolve(data, inner, options, strict);
    try {
      return [createVolatile(value), adapted];
    } catch (error) {
      throw new ValidationError2(error instanceof Error ? error.message : String(error), options);
    }
  }
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError2(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError2(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError2(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError2(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError2(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError2(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
    validateVolatileSchema(schema.inner, options.path, true);
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError2(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError2(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError2(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError2(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError2(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError2(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError2(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError2(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError2(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError2(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError2(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError2(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError2(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError2(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError2(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError2(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError2(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError2(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError2(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError2(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError2(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError2(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name, keys, format) {
  formatters[name] = format;
  Object.assign(Schema, { [name](...args) {
    const schema = new Schema({ type: name });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name === "object" || name === "dict") schema.meta.default = {};
    else if (name === "array" || name === "tuple") schema.meta.default = [];
    else if (name === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// node_modules/@deepseek-ai/dsh-timeout/lib/index.js
var MAX_TIMER_DELAY_MS = 2147483647;

// node_modules/@deepseek-ai/dsh-llm/lib/index.js
function freezeMessage(message) {
  return deepFreeze(structuredClone(message));
}
function createMessage(input) {
  return deepFreeze(structuredClone({
    ...input,
    id: brandString(randomUUID())
  }));
}
function createUserMessage(input) {
  return createMessage({
    ...input,
    role: "user"
  });
}
function createAssistantMessage(input) {
  return createMessage({
    role: "assistant",
    content: input.content,
    source: {
      kind: "model",
      ...input.source
    }
  });
}
var HarnessError = class extends Error {
  /** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
  code;
  constructor(message, code, options) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
};
var EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
var STRUCTURED_CONTEXT_OVERFLOW = new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
var TOO_LARGE_FOR_CONTEXT = new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
var EXCEEDS_MODEL_CONTEXT = new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
var DEFAULT_MAX_RETRIES = 5;
var DEFAULT_INITIAL_DELAY_MS = 500;
var DEFAULT_MAX_DELAY_MS = 1e4;
var DEFAULT_JITTER_RATIO = 0.1;
var DEFAULT_RETRYABLE_CODES = Object.freeze([
  EMPTY_RESPONSE_CODE,
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT"
]);
var backoffSchema = Schema.object({
  initialDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
  maxDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
  jitterRatio: Schema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
var normalPolicySchema = Schema.object({
  mode: Schema.const("normal").required(),
  maxRetries: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
  retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
  backoff: backoffSchema
});
var alwaysPolicySchema = Schema.object({
  mode: Schema.const("always").required(),
  backoff: backoffSchema
});
var RetryPolicySchema = Schema.union([normalPolicySchema, alwaysPolicySchema]);
var NORMAL_POLICY_KEYS = /* @__PURE__ */ new Set([
  "mode",
  "maxRetries",
  "retryableCodes",
  "backoff"
]);
var ALWAYS_POLICY_KEYS = /* @__PURE__ */ new Set([
  "mode",
  "maxRetries",
  "retryableCodes",
  "backoff"
]);
var BACKOFF_KEYS = /* @__PURE__ */ new Set([
  "initialDelayMs",
  "maxDelayMs",
  "jitterRatio"
]);
function validateKeys(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`);
}
function resolveBackoff(config, path) {
  if (config !== void 0) validateKeys(config, BACKOFF_KEYS, path);
  const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO;
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  if (initialDelayMs > maxDelayMs) throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new Error(`${path}.jitterRatio must be between 0 and 1`);
  return Object.freeze({
    initialDelayMs,
    maxDelayMs,
    jitterRatio
  });
}
function resolveRetryPolicy(config, path) {
  if (config === void 0) return Object.freeze({
    mode: "normal",
    maxRetries: DEFAULT_MAX_RETRIES,
    retryableCodes: DEFAULT_RETRYABLE_CODES,
    ...resolveBackoff(void 0, `${path}.backoff`)
  });
  switch (config.mode) {
    case "normal": {
      validateKeys(config, NORMAL_POLICY_KEYS, path);
      const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
      const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES];
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error(`${path}.maxRetries must be a non-negative safe integer`);
      if (retryableCodes.length === 0) throw new Error(`${path}.retryableCodes must not be empty`);
      if (retryableCodes.some((code) => typeof code !== "string" || code.length === 0)) throw new Error(`${path}.retryableCodes must contain only non-empty strings`);
      if (new Set(retryableCodes).size !== retryableCodes.length) throw new Error(`${path}.retryableCodes must not contain duplicates`);
      return Object.freeze({
        mode: "normal",
        maxRetries,
        retryableCodes: Object.freeze([...retryableCodes]),
        ...resolveBackoff(config.backoff, `${path}.backoff`)
      });
    }
    case "always":
      validateKeys(config, ALWAYS_POLICY_KEYS, path);
      return Object.freeze({
        mode: "always",
        ...resolveBackoff(config.backoff, `${path}.backoff`)
      });
    default:
      throw new Error(`${path}.mode must be "normal" or "always"`);
  }
}
function callConfigEquals(a, b) {
  if (a.provider !== b.provider || a.model !== b.model || a.reasoningEffort !== b.reasoningEffort || a.temperature !== b.temperature || a.maxTokens !== b.maxTokens) return false;
  if (a.stop === void 0 || b.stop === void 0) return a.stop === b.stop;
  return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i]);
}
function normalizeLlmFailure(value) {
  const error = value instanceof Error ? value : new HarnessError(thrownMessage(value), "UNKNOWN", { cause: value });
  const carried = ownFailureSnapshot(error);
  if (carried !== void 0 && carried.code === ownErrorCode(error)) return carried;
  return Object.freeze({
    message: errorMessage(error),
    code: harnessErrorCode(error)
  });
}
function thrownMessage(value) {
  try {
    const message = String(value);
    return message.length > 0 ? message : "LLM adapter failed";
  } catch (_hostileThrownValue) {
    return "LLM adapter failed";
  }
}
function ownErrorCode(error) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor !== void 0 && "value" in descriptor ? descriptor.value : void 0;
  } catch (_sdkPropertyTrap) {
    return;
  }
}
function ownFailureSnapshot(error) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
    return descriptor !== void 0 && "value" in descriptor ? failureSnapshot(descriptor.value) : void 0;
  } catch (_sdkPropertyTrap) {
    return;
  }
}
function failureSnapshot(value) {
  if (typeof value !== "object" || value === null) return void 0;
  try {
    const candidate = value;
    const message = candidate.message;
    const code = candidate.code;
    const status = candidate.status;
    const providerRetryAfterMs = candidate.providerRetryAfterMs;
    const requestId = candidate.requestId;
    const offloadImages = candidate.offloadImages;
    if (typeof message !== "string" || message.length === 0 || typeof code !== "string" || code.length === 0 || status !== void 0 && (!Number.isInteger(status) || status < 100 || status > 599) || providerRetryAfterMs !== void 0 && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0) || requestId !== void 0 && (typeof requestId !== "string" || requestId.length === 0) || offloadImages !== void 0 && (!Number.isSafeInteger(offloadImages) || offloadImages <= 0)) return void 0;
    return Object.freeze({
      message,
      code,
      ...status === void 0 ? {} : { status },
      ...providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs },
      ...requestId === void 0 ? {} : { requestId },
      ...offloadImages === void 0 ? {} : { offloadImages }
    });
  } catch (_sdkFailureGetter) {
    return;
  }
}
function errorMessage(error) {
  try {
    const message = error.message;
    if (typeof message === "string" && message.length > 0) return message;
  } catch (_sdkMessageGetter) {
  }
  return "LLM adapter failed";
}
function harnessErrorCode(error) {
  return error instanceof HarnessError ? error.code : "UNKNOWN";
}
function quoted(value) {
  return JSON.stringify(value);
}
function textOnlyImageText(ref) {
  return `[image omitted because this model accepts text only; attachment sha256:${String(ref.attachmentId).slice(7, 15)}]`;
}
function contentHasImage(content) {
  return content.some((block) => block.type === "image");
}
function contentHasFile(content) {
  for (const block of content) if (block.type === "file") return true;
  return false;
}
function fileHandleText(ref, readonlyPath) {
  const digest = String(ref.attachmentId).slice(7, 15);
  const identity = `File ${quoted(ref.name)} (${ref.bytes} bytes, sha256:${digest})`;
  if (readonlyPath === void 0) return `[${identity} was uploaded, but the current execution environment cannot access a readable path. Report that limitation if its contents are needed; do not claim to have read it.]`;
  return `[${identity}: verbatim read-only copy saved at ${quoted(readonlyPath)}. Read that path with your file tools when its contents are needed; copy it to a writable location before modifying it. When delegating file work, include this saved path in the delegation prompt; only subagents sharing this execution environment can read it.]`;
}
function replaceFilesWithHandles(blocks, resolvePath) {
  let next;
  for (const [index, block] of blocks.entries()) {
    if (block.type === "file") {
      next ??= blocks.slice(0, index);
      next.push({
        type: "text",
        text: fileHandleText(block.attachment, resolvePath(block.attachment))
      });
      continue;
    }
    next?.push(block);
  }
  return next ?? blocks;
}
function projectFilesToText(messages, resolvePath) {
  if (!messages.some((message) => contentHasFile(message.content))) return messages;
  return messages.map((message) => {
    const content = replaceFilesWithHandles(message.content, resolvePath);
    return content === message.content ? message : {
      ...message,
      content
    };
  });
}
function replaceImagesForTextModel(blocks) {
  let next;
  for (const [index, block] of blocks.entries()) {
    if (block.type === "image") {
      next ??= blocks.slice(0, index);
      next.push({
        type: "text",
        text: textOnlyImageText(block.attachment)
      });
      continue;
    }
    next?.push(block);
  }
  return next ?? blocks;
}
function projectImagesForTextModel(messages) {
  if (!messages.some((message) => contentHasImage(message.content))) return messages;
  return messages.map((message) => {
    const content = replaceImagesForTextModel(message.content);
    return content === message.content ? message : {
      ...message,
      content
    };
  });
}
function withoutDeveloperMessages(messages) {
  const retained = messages.filter((message) => message.role !== "developer");
  return retained.length === messages.length ? messages : retained;
}
function toolDeclarations(tools, mode, history) {
  const declarations = new Map(history.tools.map((tool) => [tool.name, tool]));
  for (const update of history.updates) for (const tool of update.additions) if (!declarations.has(tool.name)) declarations.set(tool.name, {
    ...tool,
    deferLoading: true
  });
  switch (mode) {
    case "in-history":
      return declarations;
    case "addition-only": {
      const activeNames = new Set(tools?.map((tool) => tool.name));
      for (const name of declarations.keys()) if (!activeNames.has(name)) declarations.delete(name);
      return declarations;
    }
    /* v8 ignore next 2 -- closed-union exhaustiveness guard */
    default:
      return assertNever(mode);
  }
}
function projectToolUpdates(messages, tools, toolUpdate, history) {
  if (toolUpdate === void 0) {
    let immediateTools = tools;
    if (tools?.some((tool) => tool.deferLoading === true)) immediateTools = tools.map(({ deferLoading: _loading, ...tool }) => tool);
    return {
      messages: withoutDeveloperMessages(messages),
      tools: immediateTools
    };
  }
  if (history === void 0) return {
    messages: withoutDeveloperMessages(messages),
    tools
  };
  const messageIds = new Set(messages.flatMap((message) => message.role === "developer" ? [message.id] : []));
  if (history.updates.some((update) => !messageIds.has(update.messageId))) return {
    messages: withoutDeveloperMessages(messages),
    tools
  };
  const declarations = toolDeclarations(tools, toolUpdate, history);
  const updateIds = new Set(history.updates.map((update) => update.messageId));
  const offered = new Set(history.tools.filter((tool) => !tool.deferLoading).map((tool) => tool.name));
  const projectedMessages = [];
  for (const message of messages) {
    if (message.role !== "developer") {
      projectedMessages.push(message);
      continue;
    }
    if (!updateIds.has(message.id)) continue;
    const content = message.content.filter((block) => {
      switch (block.type) {
        case "tool-addition":
          if (!declarations.has(block.toolName) || offered.has(block.toolName)) return false;
          offered.add(block.toolName);
          return true;
        case "tool-removal":
          if (toolUpdate !== "in-history") return false;
          return offered.delete(block.toolName);
        default:
          return true;
      }
    });
    if (content.length === 0) continue;
    if (content.length === message.content.length) projectedMessages.push(message);
    else projectedMessages.push({
      ...message,
      content
    });
  }
  return {
    messages: projectedMessages.length === messages.length && projectedMessages.every((message, index) => message === messages[index]) ? messages : projectedMessages,
    tools: [...declarations.values()]
  };
}
var { version } = createRequire(import.meta.url)("../package.json");
function ReasoningEffortId(id) {
  return brandString(id);
}
var __runInitializers = function(thisArg, initializers, value) {
  var useValue = arguments.length > 2;
  for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
  return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
  function accept(f) {
    if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
    return f;
  }
  var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
  var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
  var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
  var _, done = false;
  for (var i = decorators.length - 1; i >= 0; i--) {
    var context = {};
    for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
    for (var p in contextIn.access) context.access[p] = contextIn.access[p];
    context.addInitializer = function(f) {
      if (done) throw new TypeError("Cannot add initializers after decoration has completed");
      extraInitializers.push(accept(f || null));
    };
    var result = (0, decorators[i])(kind === "accessor" ? {
      get: descriptor.get,
      set: descriptor.set
    } : descriptor[key], context);
    if (kind === "accessor") {
      if (result === void 0) continue;
      if (result === null || typeof result !== "object") throw new TypeError("Object expected");
      if (_ = accept(result.get)) descriptor.get = _;
      if (_ = accept(result.set)) descriptor.set = _;
      if (_ = accept(result.init)) initializers.unshift(_);
    } else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
    else descriptor[key] = _;
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor);
  done = true;
};
var LlmError = class extends HarnessError {
  /** Serializable facts retained beside this live Error. */
  failure;
  /**
  * @param message - non-empty human-readable failure summary.
  * @param code - non-empty stable provider-neutral machine code.
  * @param options - optional cause and validated serializable provider facts.
  */
  constructor(message, code, options) {
    if (typeof message !== "string" || message.length === 0) throw new Error("LlmError message must be a non-empty string");
    if (typeof code !== "string" || code.length === 0) throw new Error("LlmError code must be a non-empty string");
    if (options?.status !== void 0 && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) throw new Error("LlmError status must be an integer from 100 through 599");
    if (options?.providerRetryAfterMs !== void 0 && (!Number.isFinite(options.providerRetryAfterMs) || options.providerRetryAfterMs <= 0)) throw new Error("LlmError providerRetryAfterMs must be a positive finite number");
    if (options?.requestId !== void 0 && (typeof options.requestId !== "string" || options.requestId.length === 0)) throw new Error("LlmError requestId must be a non-empty string");
    super(message, code, options);
    this.name = "LlmError";
    this.failure = Object.freeze({
      message,
      code,
      ...options?.status === void 0 ? {} : { status: options.status },
      ...options?.providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs: options.providerRetryAfterMs },
      ...options?.requestId === void 0 ? {} : { requestId: options.requestId },
      ...options?.offloadImages === void 0 ? {} : { offloadImages: options.offloadImages }
    });
  }
};
var LlmRuntime = (() => {
  let _classSuper = TypertRemoteService;
  let _instanceExtraInitializers = [];
  let _listProviders_decorators;
  let _listConfigurableProviders_decorators;
  let _remoteDiscoverModels_decorators;
  return class LlmRuntime extends _classSuper {
    static {
      const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
      _listProviders_decorators = [Remote];
      _listConfigurableProviders_decorators = [Remote];
      _remoteDiscoverModels_decorators = [Remote("discoverModels")];
      __esDecorate(this, null, _listProviders_decorators, {
        kind: "method",
        name: "listProviders",
        static: false,
        private: false,
        access: {
          has: (obj) => "listProviders" in obj,
          get: (obj) => obj.listProviders
        },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      __esDecorate(this, null, _listConfigurableProviders_decorators, {
        kind: "method",
        name: "listConfigurableProviders",
        static: false,
        private: false,
        access: {
          has: (obj) => "listConfigurableProviders" in obj,
          get: (obj) => obj.listConfigurableProviders
        },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      __esDecorate(this, null, _remoteDiscoverModels_decorators, {
        kind: "method",
        name: "remoteDiscoverModels",
        static: false,
        private: false,
        access: {
          has: (obj) => "remoteDiscoverModels" in obj,
          get: (obj) => obj.remoteDiscoverModels
        },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      if (_metadata) Object.defineProperty(this, Symbol.metadata, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: _metadata
      });
    }
    adapters = (__runInitializers(this, _instanceExtraInitializers), /* @__PURE__ */ new Map());
    directory = /* @__PURE__ */ new Map();
    discoveries = /* @__PURE__ */ new Map();
    constructor(ctx) {
      super(ctx, "llm");
    }
    /** Notify topology observers without letting one broken listener veto the commit. */
    emitAdaptersUpdated() {
      let invariantFailure;
      for (const listener of this.ctx.events.dispatch("emit", ["llm/adapters-updated"])) try {
        const returned = listener();
        if (returned != null && typeof returned.then === "function") Promise.resolve(returned).then(void 0, (error) => {
          this.warnAdaptersListenerFailure(error);
        });
      } catch (error) {
        if (error?.code === "INVARIANT") {
          invariantFailure ??= error;
          continue;
        }
        this.warnAdaptersListenerFailure(error);
      }
      if (invariantFailure !== void 0) throw invariantFailure;
    }
    /** Contained-listener diagnostic shared by the sync and async failure paths. */
    warnAdaptersListenerFailure(error) {
      this.ctx.logger.warn("llm: an llm/adapters-updated listener failed");
      this.ctx.logger.warn(error);
    }
    /**
    * Register an adapter for the given provider routes. Throws `LlmError` with code
    * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
    * Disposed with the fiber.
    * @param providers - every provider route this adapter should serve.
    * @param adapter - the adapter that streams calls for those providers.
    * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
    */
    registerAdapter(providers, adapter) {
      const owned = /* @__PURE__ */ new Set();
      let released = false;
      const dispose = this.ctx.effect(function* () {
        if (providers.length === 0) throw new LlmError("an adapter must register at least one provider", "INVALID_ADAPTER");
        this.commitRoutes(owned, this.prepareRoutes(providers, adapter, owned));
        yield () => {
          released = true;
          for (const provider of owned) this.adapters.delete(provider);
          owned.clear();
          this.emitAdaptersUpdated();
        };
      }.bind(this), "llm.registerAdapter()");
      const handle = (() => void dispose());
      handle.replace = (next) => {
        if (released) throw new LlmError("a disposed adapter registration cannot replace its routes", "REGISTRATION_DISPOSED");
        this.commitRoutes(owned, this.prepareRoutes(next, adapter, owned));
      };
      return handle;
    }
    /**
    * Validate one candidate route set for `adapter`, treating routes this
    * registration already holds as available. Nothing is mutated: a rejected
    * candidate leaves the registry exactly as it was.
    */
    prepareRoutes(providers, adapter, owned) {
      const unique = /* @__PURE__ */ new Set();
      const registrations = [];
      for (const provider of providers) {
        if (provider.length === 0) throw new LlmError("adapter provider names must be non-empty", "INVALID_ADAPTER");
        if (unique.has(provider) || this.adapters.has(provider) && !owned.has(provider)) throw new LlmError(`an adapter for provider "${provider}" is already registered`, "DUPLICATE_ADAPTER");
        const info = adapter.providerInfo(provider);
        if (typeof info.id !== "string" || info.id !== provider || typeof info.name !== "string" || info.name.length === 0) throw new LlmError(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`, "INVALID_ADAPTER");
        unique.add(provider);
        const retryPolicy = adapter.providerRetryPolicy(provider) ?? resolveRetryPolicy(void 0, `llm: provider "${provider}" retryPolicy`);
        registrations.push({
          adapter,
          provider: {
            id: info.id,
            name: info.name
          },
          retryPolicy
        });
      }
      return registrations;
    }
    /**
    * Swap this registration's routes for the prepared ones in one synchronous
    * section, so no observer can see the registry between the release and the
    * re-registration. The route set's one mutation point is also where
    * `llm/adapters-updated` is published, so a `replace` announces itself
    * exactly like a first registration.
    */
    commitRoutes(owned, registrations) {
      for (const provider of owned) this.adapters.delete(provider);
      owned.clear();
      for (const registration of registrations) {
        this.adapters.set(registration.provider.id, registration);
        owned.add(registration.provider.id);
      }
      this.emitAdaptersUpdated();
    }
    /**
    * Describe provider routes with a registered adapter.
    * @returns detached provider metadata in registration order.
    */
    listProviders() {
      return [...this.adapters.values()].map(({ provider }) => ({ ...provider }));
    }
    /**
    * Declare provider routes an adapter plugin can activate through
    * configuration. Registration is all-or-nothing: an empty list, invalid
    * entry, or a provider already declared by any registration throws
    * `LlmError` without registering the rest. Disposed with the fiber.
    * @param entries - every configurable provider this plugin owns.
    * @returns a handle that withdraws all of them, and can atomically replace them.
    */
    registerConfigurableProviders(entries) {
      let held = [];
      let disposed = false;
      const commit = (candidates) => {
        const detached = [];
        const own = new Set(held.map((entry) => entry.provider));
        for (const entry of candidates) {
          if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) throw new LlmError("configurable providers need a non-empty provider, displayName, and settingsNs", "INVALID_DIRECTORY");
          if (entry.settingsPath.some((segment) => segment.length === 0)) throw new LlmError(`configurable provider "${entry.provider}" has an empty settingsPath segment`, "INVALID_DIRECTORY");
          if (this.directory.has(entry.provider) && !own.has(entry.provider) || detached.some((seen) => seen.provider === entry.provider)) throw new LlmError(`configurable provider "${entry.provider}" is already declared`, "DUPLICATE_DIRECTORY");
          detached.push({
            ...entry,
            settingsPath: [...entry.settingsPath]
          });
        }
        for (const entry of held) this.directory.delete(entry.provider);
        for (const entry of detached) this.directory.set(entry.provider, entry);
        held = detached;
        this.emitAdaptersUpdated();
      };
      const dispose = this.ctx.effect(function* () {
        if (entries.length === 0) throw new LlmError("a configurable-provider registration must declare at least one provider", "INVALID_DIRECTORY");
        commit(entries);
        yield () => {
          disposed = true;
          for (const entry of held) this.directory.delete(entry.provider);
          held = [];
          this.emitAdaptersUpdated();
        };
      }.bind(this), "llm.registerConfigurableProviders()");
      const handle = (() => void dispose());
      handle.replace = (next) => {
        if (disposed) throw new LlmError("this configurable-provider registration was disposed", "REGISTRATION_DISPOSED");
        commit(next);
      };
      return handle;
    }
    /**
    * List every declared configurable provider, registered or dormant.
    * @returns detached directory entries in declaration order.
    */
    listConfigurableProviders() {
      return [...this.directory.values()].map((entry) => ({
        ...entry,
        settingsPath: [...entry.settingsPath]
      }));
    }
    /**
    * Offer to interrogate provider endpoints on behalf of the settings
    * namespace this plugin owns. The namespace is the key because that is what
    * a configuration surface already holds from the configurable-provider
    * directory, and because a provider being *added* has no route to name yet.
    * Disposed with the fiber.
    * @param settingsNs - the namespace whose profiles this discovery serves.
    * @param discover - interrogates one endpoint and must honor the supplied signal.
    * @returns the disposer that withdraws the offer.
    */
    registerModelDiscovery(settingsNs, discover) {
      const dispose = this.ctx.effect(function* () {
        if (settingsNs.length === 0) throw new LlmError("model discovery needs a non-empty settings namespace", "INVALID_DISCOVERY");
        if (this.discoveries.has(settingsNs)) throw new LlmError(`model discovery for "${settingsNs}" is already registered`, "DUPLICATE_DISCOVERY");
        this.discoveries.set(settingsNs, discover);
        yield () => {
          this.discoveries.delete(settingsNs);
        };
      }.bind(this), "llm.registerModelDiscovery()");
      return () => void dispose();
    }
    /**
    * Interrogate one provider endpoint for the models it advertises. The
    * request describes a draft, not a stored route, so nothing here reads or
    * writes settings or credentials — the caller owns both, and the reply is
    * candidate metadata a surface may offer for adoption.
    * @param settingsNs - namespace whose registered discovery serves this draft.
    * @param request - the endpoint, protocol, and one-shot credential to use.
    * @param signal - caller cancellation.
    * @returns the advertised models, deduplicated in endpoint order.
    */
    async discoverModels(settingsNs, request, signal) {
      const discover = this.discoveries.get(settingsNs);
      if (discover === void 0) throw new LlmError(`no model discovery is registered for "${settingsNs}"`, "NO_DISCOVERY");
      if ((request.provider ?? "").length === 0 && (request.baseURL ?? "").length === 0) throw new LlmError("model discovery needs a provider route or a baseURL", "INVALID_DISCOVERY");
      const discovered = signal === void 0 ? await discover(request) : await discover(request, signal);
      const seen = /* @__PURE__ */ new Set();
      const models = [];
      for (const model of discovered) {
        if (typeof model.id !== "string" || model.id.length === 0 || seen.has(model.id)) continue;
        seen.add(model.id);
        models.push({
          id: model.id,
          ...model.name === void 0 ? {} : { name: model.name },
          ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
          ...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
          ...model.inputModalities === void 0 ? {} : { inputModalities: [...model.inputModalities] }
        });
      }
      return models;
    }
    /**
    * Remote adapter for one draft provider interrogation.
    * @param settingsNs - namespace whose registered discovery serves this draft.
    * @param request - endpoint, protocol, and one-shot credential to use.
    * @param signal - caller cancellation supplied by the Remote carrier.
    * @returns advertised models in endpoint order.
    * @throws RemoteError with `llm/model-discovery-rejected` when discovery refuses or fails.
    */
    async remoteDiscoverModels(settingsNs, request, signal) {
      try {
        return await this.discoverModels(settingsNs, request, signal);
      } catch (error) {
        throw new RemoteError("llm/model-discovery-rejected", error instanceof Error ? error.message : String(error), {
          settingsNs,
          ...request.baseURL === void 0 ? {} : { baseURL: request.baseURL }
        }, { cause: error });
      }
    }
    /**
    * Resolve the retry policy captured when one provider route was registered.
    * @param provider - registered provider route to inspect.
    * @returns the provider-owned policy, with normal defaults already resolved.
    */
    providerRetryPolicy(provider) {
      return this.registration(provider).retryPolicy;
    }
    /**
    * Resolve provider-side request-image pricing for one exact route, or
    * `undefined` when the provider is unregistered or declares none. Unknown
    * providers degrade to `undefined` rather than throwing because callers
    * price durable history whose route may no longer be mounted.
    * @param provider - provider route named by a request header.
    * @param model - exact model id named by the same header.
    * @returns the owning adapter's image pricing for the route, when declared.
    */
    imageRequestPricing(provider, model) {
      return this.adapters.get(provider)?.adapter.imageRequestPricing(provider, model);
    }
    /**
    * Resolve the exact text one durable file occurrence contributes to every
    * provider request in the current execution environment.
    * @param ref - durable verbatim file reference from model history.
    * @returns the same deterministic handle text used at adapter dispatch.
    */
    fileRequestText(ref) {
      return fileHandleText(ref, this.fileReadPath(ref));
    }
    /** Detach typed adapter-owned modality metadata. */
    detachedModalities(modalities) {
      return modalities === void 0 ? void 0 : [...modalities];
    }
    /**
    * Discover models advertised by one registered provider. Catalog membership
    * does not constrain core routing. Catalog-driven entry points may restrict
    * selection and submission to the advertised models.
    * @param provider - registered provider route to inspect.
    * @returns detached model metadata in adapter-preferred order.
    */
    async listModels(provider) {
      const models = await this.registration(provider).adapter.listModels(provider);
      const seen = /* @__PURE__ */ new Set();
      return models.map((model) => {
        if (typeof model.provider !== "string" || model.provider !== provider || typeof model.id !== "string" || model.id.length === 0 || typeof model.name !== "string" || model.name.length === 0 || model.description !== void 0 && typeof model.description !== "string" || seen.has(model.id)) throw new LlmError(`adapter returned invalid or duplicate model metadata for provider "${provider}"`, "INVALID_CATALOG");
        seen.add(model.id);
        const inputModalities = this.detachedModalities(model.inputModalities);
        return {
          provider: model.provider,
          id: model.id,
          name: model.name,
          ...model.description === void 0 ? {} : { description: model.description },
          ...inputModalities === void 0 ? {} : { inputModalities }
        };
      });
    }
    /**
    * Resolve and validate all metadata from the adapter that owns one exact
    * route. The result is detached from adapter-owned objects; catalog
    * membership remains advisory and does not control request routing.
    * @param provider - registered provider route to inspect.
    * @param model - exact model id passed to the adapter.
    * @param signal - optional cancellation for adapter-owned asynchronous lookup.
    * @returns exact model identity plus available context and reasoning metadata.
    */
    async resolveModelInfo(provider, model, signal) {
      return this.resolveModelInfoFor(this.registration(provider), model, signal);
    }
    async resolveModelInfoFor(registration, model, signal) {
      const resolved = await registration.adapter.resolveModel(registration.provider.id, model, signal);
      return this.normalizeModelInfo(registration, model, resolved);
    }
    /** Validate and detach one adapter-returned exact model result. */
    normalizeModelInfo(registration, model, resolved) {
      const provider = registration.provider.id;
      if (typeof resolved.provider !== "string" || resolved.provider !== provider || typeof resolved.id !== "string" || resolved.id !== model || typeof resolved.name !== "string" || resolved.name.length === 0 || resolved.description !== void 0 && typeof resolved.description !== "string") throw new LlmError(`adapter returned invalid exact model metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
      const context = resolved.context;
      if (context !== void 0 && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0)) throw new LlmError(`adapter returned invalid context metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_CONTEXT");
      const inputModalities = this.detachedModalities(resolved.inputModalities);
      const systemPromptUpdate = resolved.systemPromptUpdate;
      if (systemPromptUpdate !== void 0 && systemPromptUpdate !== "in-history") throw new LlmError(`adapter returned invalid system prompt update mode for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
      const toolUpdate = resolved.toolUpdate;
      if (toolUpdate !== void 0 && toolUpdate !== "in-history" && toolUpdate !== "addition-only") throw new LlmError(`adapter returned invalid tool update mode for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
      const defaultMaxTokens = resolved.defaultMaxTokens;
      if (defaultMaxTokens !== void 0 && (!Number.isSafeInteger(defaultMaxTokens) || defaultMaxTokens <= 0)) throw new LlmError(`adapter returned invalid default maxTokens for provider "${provider}" model "${model}"`, "INVALID_MODEL_MAX_TOKENS");
      const info = {
        provider,
        id: model,
        name: resolved.name,
        ...resolved.description === void 0 ? {} : { description: resolved.description },
        ...inputModalities === void 0 ? {} : { inputModalities },
        ...context === void 0 ? {} : { context: { contextWindow: context.contextWindow } },
        ...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens },
        ...resolved.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: resolved.systemPromptUpdate },
        ...resolved.toolUpdate === void 0 ? {} : { toolUpdate: resolved.toolUpdate }
      };
      const reasoning = resolved.reasoning;
      if (reasoning === void 0) return info;
      if (reasoning.efforts.length === 0) throw new LlmError(`adapter returned invalid reasoning metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
      const seen = /* @__PURE__ */ new Set();
      const efforts = reasoning.efforts.map((effort) => {
        if (typeof effort.id !== "string" || effort.id.length === 0 || typeof effort.name !== "string" || effort.name.length === 0 || effort.description !== void 0 && typeof effort.description !== "string" || seen.has(effort.id)) throw new LlmError(`adapter returned invalid or duplicate reasoning effort metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
        seen.add(effort.id);
        return {
          id: effort.id,
          name: effort.name,
          ...effort.description === void 0 ? {} : { description: effort.description }
        };
      });
      if (reasoning.defaultEffort !== void 0 && !seen.has(reasoning.defaultEffort)) throw new LlmError(`adapter returned an unknown default reasoning effort for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
      return {
        ...info,
        reasoning: {
          efforts,
          ...reasoning.defaultEffort === void 0 ? {} : { defaultEffort: reasoning.defaultEffort }
        }
      };
    }
    /**
    * Validate a conversation call config against its exact model capability and
    * materialize adapter-configured defaults. Unsupported explicit efforts
    * reject before provider I/O; no clamping or aliasing is performed. This
    * standalone query does not bind a later dispatch; use {@link prepareCall}
    * when logging and streaming must share one adapter registration.
    * @param config - provider/model route and optional request controls.
    * @param signal - optional cancellation for adapter-owned capability lookup.
    * @returns a detached config only when a default must be materialized.
    */
    async resolveCallConfig(config, signal) {
      return (await this.resolveCallFor(this.registration(config.provider), config, signal)).config;
    }
    async resolveCallFor(registration, config, signal) {
      const info = await this.resolveModelInfoFor(registration, config.model, signal);
      return this.resolveCallWithInfo(config, info);
    }
    /** Validate request controls against one already-bound exact model result. */
    resolveCallWithInfo(config, info) {
      const defaulted = config.maxTokens === void 0 && info.defaultMaxTokens !== void 0 ? {
        ...config,
        maxTokens: info.defaultMaxTokens
      } : config;
      const reasoning = info.reasoning;
      const requested = defaulted.reasoningEffort;
      let resolvedConfig = defaulted;
      if (reasoning === void 0) {
        if (requested !== void 0) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${requested}"`, "UNSUPPORTED_REASONING_EFFORT");
      } else {
        const effective = requested ?? reasoning.defaultEffort;
        if (effective !== void 0) {
          if (!reasoning.efforts.some((effort) => effort.id === effective)) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effective}"`, "UNSUPPORTED_REASONING_EFFORT");
          if (requested !== effective) resolvedConfig = {
            ...defaulted,
            reasoningEffort: effective
          };
        }
      }
      return {
        config: resolvedConfig,
        ...info.context === void 0 ? {} : { context: info.context },
        modelInfo: info
      };
    }
    /**
    * Resolve one call under its current adapter registration. The returned
    * one-shot handle keeps that registration across header logging and dispatch,
    * so HMR cannot combine one adapter's capability result with another adapter.
    * @param config - provider/model route and optional request controls.
    * @param signal - optional cancellation for adapter-owned capability lookup.
    * @returns a prepared config and its registration-bound stream entry point.
    */
    async prepareCall(config, signal) {
      const registration = this.registration(config.provider);
      const adapterCall = await registration.adapter.prepareCall(config.provider, config.model, signal);
      const modelInfo = this.normalizeModelInfo(registration, config.model, adapterCall.model);
      const resolved = this.resolveCallWithInfo(config, modelInfo);
      const resolvedConfig = deepFreeze(structuredClone(resolved.config));
      const context = resolved.context === void 0 ? void 0 : deepFreeze(structuredClone(resolved.context));
      const adapterDefaults = deepFreeze({
        ...config.reasoningEffort === void 0 && resolvedConfig.reasoningEffort !== void 0 ? { reasoningEffort: true } : {},
        ...config.maxTokens === void 0 && resolvedConfig.maxTokens !== void 0 ? { maxTokens: true } : {}
      });
      let dispatched = false;
      return Object.freeze({
        config: resolvedConfig,
        retryPolicy: registration.retryPolicy,
        adapterDefaults,
        ...context === void 0 ? {} : { context },
        ...modelInfo.inputModalities === void 0 ? {} : { inputModalities: Object.freeze([...modelInfo.inputModalities]) },
        ...modelInfo.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: modelInfo.systemPromptUpdate },
        ...modelInfo.toolUpdate === void 0 ? {} : { toolUpdate: modelInfo.toolUpdate },
        stream: (options) => {
          if (dispatched) throw new LlmError("a prepared LLM call can only be dispatched once", "INVALID_PREPARED_CALL");
          if (!callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
          dispatched = true;
          return this.streamWithRegistration(options, {
            registration,
            config: resolvedConfig,
            modelInfo,
            dispatch: (options2) => adapterCall.stream(options2)
          });
        }
      });
    }
    registration(provider) {
      const registration = this.adapters.get(provider);
      if (!registration) throw new LlmError(`no adapter registered for provider "${provider}"`, "NO_ADAPTER");
      return registration;
    }
    /** Remove replay state whose historical route is owned by another adapter. */
    forAdapter(options, adapter) {
      const messages = options.messages.map((message) => {
        if (message.role !== "assistant") return message;
        const source = message.source;
        if (source.replayState === void 0) return message;
        if (this.adapters.get(source.provider)?.adapter === adapter) return message;
        return freezeMessage({
          ...message,
          source: {
            kind: "model",
            provider: source.provider,
            model: source.model
          }
        });
      });
      if (messages.every((message, index) => message === options.messages[index])) return options;
      const filtered = {
        ...options,
        messages
      };
      return Object.isFrozen(options) ? deepFreeze(filtered) : filtered;
    }
    /**
    * Resolve the current execution-world read path of one durable file
    * reference through the mounted attachment and filesystem providers.
    */
    fileReadPath(ref) {
      let hostPath;
      try {
        hostPath = this.ctx.get("attachments")?.fileHostPath(ref);
      } catch {
        return;
      }
      if (hostPath === void 0) return void 0;
      return this.ctx.get("fs")?.processPathFromHostPath(hostPath);
    }
    /**
    * Final adapter boundary. Adapter selection, dispatch, iterator construction,
    * and iteration failures become one terminal failure chunk. Middleware and
    * downstream consumer failures remain thrown plugin or consumer errors.
    */
    async *adapterStream(options, prepared) {
      let iterator;
      try {
        const registration = prepared?.registration ?? this.registration(options.provider);
        const adapter = registration.adapter;
        let modelInfo;
        let resolvedConfig;
        let dispatch;
        if (prepared === void 0) {
          const adapterCall = await adapter.prepareCall(options.provider, options.model, options.signal);
          modelInfo = this.normalizeModelInfo(registration, options.model, adapterCall.model);
          resolvedConfig = this.resolveCallWithInfo(options, modelInfo).config;
          dispatch = (options2) => adapterCall.stream(options2);
        } else {
          modelInfo = prepared.modelInfo;
          resolvedConfig = prepared.config;
          dispatch = prepared.dispatch;
        }
        if (prepared !== void 0 && !callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
        const resolvedOptions = callConfigEquals(options, resolvedConfig) ? options : Object.isFrozen(options) ? deepFreeze({
          ...options,
          ...resolvedConfig
        }) : {
          ...options,
          ...resolvedConfig
        };
        let projectedMessages = resolvedOptions.messages;
        if (projectedMessages.some((message) => contentHasFile(message.content))) projectedMessages = projectFilesToText(projectedMessages, (ref) => this.fileReadPath(ref));
        if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image") && projectedMessages.some((message) => contentHasImage(message.content))) projectedMessages = projectImagesForTextModel(projectedMessages);
        const projectedTools = projectToolUpdates(projectedMessages, resolvedOptions.tools, modelInfo.toolUpdate, resolvedOptions.toolHistory);
        projectedMessages = projectedTools.messages;
        let projectedOptions = resolvedOptions;
        if (projectedMessages !== resolvedOptions.messages || projectedTools.tools !== resolvedOptions.tools) {
          projectedOptions = {
            ...resolvedOptions,
            messages: projectedMessages,
            ...projectedTools.tools === void 0 ? {} : { tools: projectedTools.tools }
          };
          if (Object.isFrozen(resolvedOptions)) deepFreeze(projectedOptions);
        }
        iterator = dispatch(this.forAdapter(projectedOptions, adapter))[Symbol.asyncIterator]();
      } catch (error) {
        yield adapterFailureChunk(error, options.signal);
        return;
      }
      let completed = false;
      try {
        while (true) {
          let item;
          try {
            const next = await iterator.next();
            item = next.done ? { done: true } : {
              done: false,
              value: next.value
            };
          } catch (error) {
            completed = true;
            yield adapterFailureChunk(error, options.signal);
            return;
          }
          if (item.done) {
            completed = true;
            return;
          }
          yield item.value;
        }
      } finally {
        if (!completed) {
          const close = iterator.return?.bind(iterator);
          if (close) await close();
        }
      }
    }
    /**
    * Stream one model call as raw chunks (token-level deltas). Replay state is
    * retained only when the same adapter instance owns its historical provider
    * and the target provider. Final adapter selection remains fixed through
    * asynchronous exact-model resolution and dispatch. Adapter selection,
    * dispatch, and iteration failures become terminal `error` or `aborted`
    * finish chunks; middleware, nested-call, cleanup, and consumer failures
    * remain thrown.
    * @param options - the full request; `options.provider` selects the adapter.
    * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
    */
    stream(options) {
      return this.streamWithRegistration(options);
    }
    streamWithRegistration(options, prepared) {
      return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
    }
  };
})();
function adapterFailureChunk(error, signal) {
  const failure = normalizeLlmFailure(error);
  return {
    type: "finish",
    reason: signal?.aborted || failure.code === "ABORTED" ? {
      kind: "aborted",
      failure
    } : {
      kind: "error",
      failure
    }
  };
}

// src/llm-backend.ts
var LlmBackend = class {
  constructor(llm) {
    this.llm = llm;
  }
  llm;
  catalogCache = null;
  available() {
    return true;
  }
  listModels() {
    if (this.catalogCache === null) {
      this.catalogCache = this.buildCatalog();
    }
    return this.catalogCache;
  }
  async chat(messages, options) {
    const text = [];
    for await (const delta of this.streamChat(messages, options)) text.push(delta);
    const content = text.join("").trim();
    if (content === "") throw new Error("llm returned an empty completion");
    return { content };
  }
  async *streamChat(messages, options) {
    const request = await this.buildRequest(messages, options);
    for await (const chunk of this.llm.stream(request)) {
      if (chunk.type === "text-delta") {
        if (chunk.text !== "") yield chunk.text;
      } else if (chunk.type === "finish") {
        if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") {
          throw new Error(`llm stream finished with ${chunk.reason.kind}`);
        }
      }
    }
  }
  async buildRequest(messages, options) {
    const catalog = await this.listModels();
    const provider = options?.provider ?? catalog.default.provider;
    const model = options?.model ?? catalog.default.model;
    const system = messages[0]?.role === "system" ? messages[0].content : void 0;
    const history = system !== void 0 ? messages.slice(1) : messages;
    const llmMessages = history.map((message) => {
      const content = [{ type: "text", text: message.content }];
      if (message.role === "assistant") {
        return createAssistantMessage({ content, source: { provider, model } });
      }
      return createUserMessage({ content, source: { kind: "user" } });
    });
    return {
      provider,
      model,
      messages: llmMessages,
      ...system !== void 0 ? { system } : {},
      ...options?.effort !== void 0 ? { reasoningEffort: ReasoningEffortId(options.effort) } : {}
    };
  }
  async buildCatalog() {
    const providers = [];
    for (const provider of this.llm.listProviders()) {
      let models = [];
      try {
        models = await this.llm.listModels(provider.id);
      } catch {
        continue;
      }
      const entries = [];
      for (const model of models) {
        let efforts = [];
        let defaultEffort;
        try {
          const resolved = await this.llm.resolveModelInfo(provider.id, model.id);
          efforts = resolved.reasoning?.efforts.map((effort) => ({ id: effort.id, name: effort.name })) ?? [];
          defaultEffort = resolved.reasoning?.defaultEffort;
        } catch {
        }
        entries.push({
          id: model.id,
          name: model.name,
          ...model.description !== void 0 ? { description: model.description } : {},
          efforts,
          ...defaultEffort !== void 0 ? { defaultEffort } : {}
        });
      }
      if (entries.length > 0) {
        providers.push({ id: provider.id, name: provider.name, models: entries });
      }
    }
    const first = providers[0]?.models[0];
    return {
      providers,
      default: first !== void 0 && providers[0] !== void 0 ? { provider: providers[0].id, model: first.id } : { provider: "", model: "" }
    };
  }
};

// node_modules/@deepseek-ai/dsh-session/lib/index.js
function SessionId(id) {
  return brandString(id);
}

// src/session-progress.ts
function textOf(blocks) {
  if (blocks === void 0) return "";
  return blocks.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("").trim();
}
var ACTIVITY_ARGS_LIMIT = 60;
var ACTIVITY_TEXT_LIMIT = 60;
var SUMMARY_TEXT_LIMIT = 140;
var JOB_OUTPUT_TAIL_LIMIT = 120;
function summarizeJobs(snapshots, readOutput, limit = 5) {
  const entries = [];
  for (const job of snapshots) {
    if (job.finishedAt !== void 0) continue;
    if (entries.length >= limit) break;
    let tail;
    try {
      const output = readOutput(job.id);
      if (output !== void 0) {
        const trimmed = output.trim();
        if (trimmed !== "") tail = trimmed.slice(-JOB_OUTPUT_TAIL_LIMIT);
      }
    } catch {
      tail = void 0;
    }
    entries.push({ label: job.label, startedAt: job.startedAt, ...tail !== void 0 ? { outputTail: tail } : {} });
  }
  return entries;
}
function summarizeSession(events, now) {
  let lastTurnStart = 0;
  let lastTurnEnd = 0;
  let lastStepStart = 0;
  let lastStepEnd = 0;
  let step = 0;
  const openCalls = /* @__PURE__ */ new Map();
  const completedToolNames = [];
  let lastToolCall = null;
  let lastResult = null;
  let lastAssistantText = "";
  let nodeCount = 0;
  for (const event of events) {
    switch (event.type) {
      case "turn/start":
        lastTurnStart = event.time;
        break;
      case "turn/end":
        lastTurnEnd = event.time;
        break;
      case "step/start":
        lastStepStart = event.time;
        step = event.data.step;
        break;
      case "step/end":
        lastStepEnd = event.time;
        break;
      case "tool/call": {
        const name = event.data.name;
        openCalls.set(event.data.callId, { name });
        lastToolCall = { name, args: event.data.arguments, seq: event.seq };
        break;
      }
      case "tool/result": {
        const resultMessage = event.data.message;
        const callId = resultMessage.toolCallId;
        if (callId !== void 0) {
          const call = openCalls.get(callId);
          if (call !== void 0) {
            openCalls.delete(callId);
            completedToolNames.push(call.name);
          }
        }
        lastResult = {
          text: textOf(resultMessage.content),
          isError: event.data.error !== void 0 || resultMessage.isError === true,
          seq: event.seq
        };
        nodeCount += 1;
        break;
      }
      case "user/message":
        nodeCount += 1;
        break;
      case "assistant/message":
        nodeCount += 1;
        lastAssistantText = textOf(event.data.message.content);
        break;
      default:
        break;
    }
  }
  const running = lastTurnStart > lastTurnEnd || lastStepStart > lastStepEnd || openCalls.size > 0;
  const active = running || events.length > 0;
  const tools = [...openCalls.values()].map((call) => call.name).slice(0, 5);
  let lastActivity;
  let lastTool;
  if (lastToolCall !== null) {
    lastTool = lastToolCall.name;
    const args = lastToolCall.args.trim().slice(0, ACTIVITY_ARGS_LIMIT);
    lastActivity = args === "" ? `\u8FD0\u884C ${lastToolCall.name}` : `\u8FD0\u884C ${lastToolCall.name}\uFF1A${args}`;
  } else if (lastAssistantText !== "") {
    lastActivity = `\u6B63\u5728\u8F93\u51FA\uFF1A${lastAssistantText.slice(0, ACTIVITY_TEXT_LIMIT)}`;
  }
  let lastSummary;
  if (lastResult !== null) {
    const status = lastResult.isError ? "\u51FA\u9519" : "\u5B8C\u6210";
    const text = lastResult.text.slice(0, SUMMARY_TEXT_LIMIT);
    lastSummary = text === "" ? `\u521A${status}` : `${status}\uFF1A${text}`;
  }
  return {
    active,
    running,
    tools,
    step,
    turnMs: running && lastTurnStart > 0 ? Math.max(0, now - lastTurnStart) : 0,
    nodeCount,
    ...lastTool !== void 0 ? { lastTool } : {},
    ...lastActivity !== void 0 ? { lastActivity } : {},
    ...lastSummary !== void 0 ? { lastSummary } : {}
  };
}
function sendJson2(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}
function createProgressHandler(store, sessionQuery, jobs = null) {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/whale-pet/progress") {
      sendJson2(res, 404, { error: "not found" });
      return;
    }
    if ((req.method ?? "GET").toUpperCase() !== "GET") {
      sendJson2(res, 405, { error: "method not allowed" });
      return;
    }
    if (store === null || sessionQuery === null) {
      sendJson2(res, 503, { error: "session store unavailable" });
      return;
    }
    const rawId = url.searchParams.get("session");
    if (rawId === null || rawId === "") {
      sendJson2(res, 400, { error: "missing session id" });
      return;
    }
    const sessionId = SessionId(rawId);
    const session = store.get(sessionId);
    if (session === void 0) {
      sendJson2(res, 404, { error: "session not found" });
      return;
    }
    const observation = await sessionQuery.observeSession(sessionId, { projectionMode: "none" });
    let summary;
    try {
      summary = summarizeSession(observation.events, Date.now());
    } finally {
      observation[Symbol.dispose]();
    }
    if (jobs !== null) {
      try {
        const caller = SessionId(rawId);
        const runningJobs = summarizeJobs(jobs.list(caller), (id) => {
          const job = jobs.get(id, caller);
          const from2 = Math.max(job.output.earliest, job.output.total - JOB_OUTPUT_TAIL_LIMIT);
          return jobs.readAt(id, from2, caller).chunks.map((chunk) => chunk.text).join("");
        });
        if (runningJobs.length > 0) summary.jobs = runningJobs;
      } catch {
      }
    }
    sendJson2(res, 200, summary);
  };
}

// src/subagent-task.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var TASK_TIMEOUT_MS = 6e4;
var TASK_OUTPUT_LIMIT = 1200;
function textOf2(blocks) {
  if (blocks === void 0) return "";
  return blocks.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("").trim();
}
function taskPersona(prompt) {
  const firstLine = prompt.split("\n")[0]?.trim() ?? prompt;
  return [
    `\u9CB8\u9CB8\u7684\u4EFB\u52A1\uFF1A${firstLine.slice(0, 40)}`,
    "",
    "\u4F60\u662F DeepSeek Harness \u91CC\u7684\u4EFB\u52A1\u52A9\u624B\uFF0C\u684C\u5BA0\u9CB8\u9CB8\u66FF\u7528\u6237\u6D3E\u53D1\u4E86\u8FD9\u4E2A\u4EFB\u52A1\u3002",
    "\u8BF7\u72EC\u7ACB\u5B8C\u6210\u5B83\uFF1A\u53EF\u4EE5\u8C03\u7528\u5DE5\u5177\uFF08bash\u3001\u6587\u4EF6\u3001\u641C\u7D22\u7B49\uFF09\u5B9E\u9645\u6267\u884C\uFF0C\u4E0D\u8981\u53EA\u7ED9\u65B9\u6848\u3002",
    "\u4EFB\u52A1\u5B8C\u6210\u540E\uFF0C\u7528\u4E00\u6BB5\u4E0D\u8D85\u8FC7 200 \u5B57\u7684\u603B\u7ED3\u8BF4\u660E\u4F60\u505A\u4E86\u4EC0\u4E48\u548C\u6700\u7EC8\u7ED3\u679C\uFF08\u542B\u5173\u952E\u8F93\u51FA\uFF09\u3002",
    `\u5B8C\u6574\u4EFB\u52A1\uFF1A${prompt}`
  ].join("\n");
}
function sendJson3(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}
var TASK_MAX_BODY_BYTES = 64 * 1024;
async function readJsonBody2(req, limit = TASK_MAX_BODY_BYTES) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) return null;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
function turnEndReasonOf(events) {
  for (const event of [...events].reverse()) {
    if (event.type === "turn/end") return event.data.reason;
  }
  return void 0;
}
function finalAssistantText(events) {
  for (const event of [...events].reverse()) {
    if (event.type === "assistant/message") {
      const text = textOf2(event.data.message.content);
      if (text !== "") return text;
    }
  }
  return "";
}
function createTaskHandler(agents, agentPresets, sessions, sessionQuery, workspaceRoot, defaultPreset = () => void 0, defaultModel = () => void 0, timeoutMs = TASK_TIMEOUT_MS) {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/whale-pet/task") {
      sendJson3(res, 404, { error: "not found" });
      return;
    }
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
      sendJson3(res, 405, { error: "method not allowed" });
      return;
    }
    if (sessionQuery === null) {
      sendJson3(res, 503, { error: "session query service unavailable" });
      return;
    }
    const body = await readJsonBody2(req);
    if (body === null || typeof body !== "object") {
      sendJson3(res, 400, { error: "request body must be JSON: { prompt: string, session?: string }" });
      return;
    }
    const record = body;
    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
    if (prompt === "") {
      sendJson3(res, 400, { error: "missing prompt" });
      return;
    }
    const callerSessionId = typeof record.session === "string" && record.session !== "" ? record.session : void 0;
    const cwd = callerSessionId !== void 0 && sessions !== null ? (() => {
      try {
        return sessions.get(SessionId(callerSessionId))?.header.cwd;
      } catch {
        return void 0;
      }
    })() : void 0;
    const resolvedCwd = cwd ?? workspaceRoot();
    const preset = defaultPreset();
    const model = defaultModel();
    const agentOptions = model?.provider !== void 0 && model?.model !== void 0 ? { provider: model.provider, model: model.model } : void 0;
    let handle = null;
    let presetMounted = false;
    let presetMountError;
    try {
      handle = await agents.create({
        sessionId: SessionId(randomUUID2()),
        meta: {
          ...resolvedCwd !== void 0 ? { cwd: resolvedCwd } : {},
          ...preset !== void 0 ? { agentPreset: preset } : {},
          ...callerSessionId !== void 0 ? { parentSession: SessionId(callerSessionId) } : {},
          delegationDepth: 1
        },
        ...agentOptions !== void 0 ? { agentOptions } : {},
        // Compose the deployment preset (bash, fs, web, …) into the child's
        // scope, exactly like the main agent creation path does — without it
        // the child only sees globally registered tools. A mount failure does
        // not roll the task back: the child still runs, just without the
        // preset toolset.
        ...agentPresets !== null && preset !== void 0 ? {
          setup: async (agentCtx) => {
            try {
              await agentPresets.mount(agentCtx, preset);
              presetMounted = true;
            } catch (error) {
              presetMountError = error instanceof Error ? error.message : String(error);
            }
          }
        } : {}
      });
      const child = handle.agent;
      let stopReason = "unknown";
      let timedOut = false;
      try {
        child.followup(createUserMessage({
          content: [{ type: "text", text: taskPersona(prompt) }],
          source: { kind: "user" }
        }));
        const timeout = new Promise((resolve2) => setTimeout(() => resolve2("timeout"), timeoutMs));
        const settled = await Promise.race([child.whenIdle().then(() => "idle"), timeout]);
        timedOut = settled === "timeout";
        if (!timedOut) stopReason = "completed";
      } catch (error) {
        stopReason = error instanceof Error ? error.message : String(error);
      }
      const observation = await sessionQuery.observeSession(child.session.id, { projectionMode: "none" });
      try {
        const events = observation.events;
        const reason = turnEndReasonOf(events);
        const reasonKind = typeof reason === "object" && reason !== null && reason.kind === "error" ? "error" : "completed";
        let output = finalAssistantText(events).slice(0, TASK_OUTPUT_LIMIT);
        if (output === "" && reasonKind === "error") {
          const failure = reason?.error;
          output = failure !== void 0 ? `\u5B50\u4EE3\u7406\u56DE\u5408\u51FA\u9519\uFF1A${failure.code ?? ""} ${failure.message ?? ""}`.trim().slice(0, 300) : "\u5B50\u4EE3\u7406\u56DE\u5408\u51FA\u9519";
        } else if (output === "" && timedOut) {
          output = "\u4EFB\u52A1\u4ECD\u5728\u8FDB\u884C\u4E2D\uFF0C\u53EF\u6253\u5F00\u4F1A\u8BDD\u67E5\u770B\u8FDB\u5EA6";
        }
        const response = {
          output,
          sessionId: child.session.id,
          completed: reasonKind === "completed" && output !== "" && !timedOut,
          debug: {
            stopReason,
            eventCount: events.length,
            eventTypes: [...new Set(events.map((event) => event.type))],
            turnEndReason: reason,
            presetMounted,
            ...presetMountError !== void 0 ? { presetMountError } : {}
          }
        };
        sendJson3(res, 200, response);
      } finally {
        observation[Symbol.dispose]();
      }
    } catch (error) {
      sendJson3(res, 502, { error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
  };
}

// src/index.ts
var inject = ["webServer", "llm", "credentials", "sessions", "sessionQuery", "jobs", "agents", "agentPresets", "agentDefaultModel"];
function safeCredentials(ctx) {
  try {
    return ctx.credentials;
  } catch {
    return null;
  }
}
function safeLlm(ctx) {
  try {
    return ctx.llm;
  } catch {
    return null;
  }
}
function safeSessions(ctx) {
  try {
    return ctx.sessions ?? null;
  } catch {
    return null;
  }
}
function safeSessionQuery(ctx) {
  try {
    return ctx.sessionQuery ?? null;
  } catch {
    return null;
  }
}
function safeJobs(ctx) {
  try {
    return ctx.jobs ?? null;
  } catch {
    return null;
  }
}
function safeAgents(ctx) {
  try {
    return ctx.agents ?? null;
  } catch {
    return null;
  }
}
function safeAgentPresets(ctx) {
  try {
    return ctx.agentPresets ?? null;
  } catch {
    return null;
  }
}
function safeAgentDefaultModel(ctx) {
  try {
    return ctx.agentDefaultModel ?? null;
  } catch {
    return null;
  }
}
function safeWorkspaces(ctx) {
  try {
    return ctx.workspaceRegistry ?? null;
  } catch {
    return null;
  }
}
function apply(ctx, config) {
  const credentials = safeCredentials(ctx);
  const llm = safeLlm(ctx);
  const resolveDirect = async () => {
    const env = {
      apiKey: process.env.DSH_WHALE_API_KEY ?? process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DSH_WHALE_API_BASE,
      model: process.env.DSH_WHALE_API_MODEL
    };
    const direct = resolveChatProxyConfig(env, config);
    if (direct !== null) return direct;
    if (credentials !== null) {
      try {
        const resolved = await credentials.resolve(credentialRef("DEEPSEEK_API_KEY"));
        if (resolved !== void 0 && resolved.value !== "") {
          return resolveChatProxyConfig({ ...env, apiKey: resolved.value });
        }
      } catch {
      }
    }
    return null;
  };
  const backend = llm !== null ? new LlmBackend(llm) : directBackend(resolveDirect);
  const sessions = safeSessions(ctx);
  const sessionQuery = safeSessionQuery(ctx);
  const jobs = safeJobs(ctx);
  const agents = safeAgents(ctx);
  const agentPresets = safeAgentPresets(ctx);
  const agentDefaultModel = safeAgentDefaultModel(ctx);
  const workspaces = safeWorkspaces(ctx);
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/api/whale-pet",
    handler: createChatProxyHandler(backend)
  }), "ui-whale-pet: chat proxy");
  if (sessions !== null) {
    ctx.effect(() => ctx.webServer.register({
      kind: "exact",
      path: "/api/whale-pet/progress",
      handler: createProgressHandler(sessions, sessionQuery, jobs)
    }), "ui-whale-pet: session progress");
  }
  if (agents !== null) {
    ctx.effect(() => ctx.webServer.register({
      kind: "exact",
      path: "/api/whale-pet/task",
      handler: createTaskHandler(agents, agentPresets, sessions, sessionQuery, () => workspaces?.list()[0]?.path, () => {
        try {
          return agentPresets?.defaultId;
        } catch {
          return void 0;
        }
      }, () => {
        if (agentDefaultModel === null) return void 0;
        try {
          const value = agentDefaultModel.currentSelection();
          return { provider: value.provider, model: value.model };
        } catch {
          return void 0;
        }
      })
    }), "ui-whale-pet: subagent task");
  }
  void Promise.resolve(backend.available()).then((configured) => {
    if (configured) {
      console.log(`[ui-whale-pet] chat proxy mounted at /api/whale-pet (backend: ${llm !== null ? "dsh llm service" : "direct upstream"})`);
    } else {
      console.warn("[ui-whale-pet] chat proxy mounted at /api/whale-pet without an API key \u2014 set DSH_WHALE_API_KEY (or DEEPSEEK_API_KEY) or the plugin config.apiKey");
    }
  });
}
export {
  apply,
  inject
};
