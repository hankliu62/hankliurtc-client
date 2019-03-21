export default class EventEmitter {
  constructor() {
    this.events = {};
  }

  on = (eventName, listener) => {
    this.events[eventName] = this.events[eventName] || [];
    this.events[eventName].push(listener);
  }

  emit = (eventName, ...args) => {
    const listeners = this.events[eventName] || [];
    for (const listener of listeners) {
      listener.apply(null, args);
    }
  }
}