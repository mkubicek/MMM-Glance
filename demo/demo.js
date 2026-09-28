/* Just enough of MagicMirror² (Module.register, updateDom with a fade, file, sockets) to run
 * the real module front end against the demo server's synthetic data.
 * URL options:
 *   ?card=lake     pin one card (sky, lake, upcoming, wine) instead of rotating
 *   ?grid          all four cards side by side
 *   ?at=2026-10-12T14:40:00Z   pretend it is that moment (the clock keeps running from there)
 */
(function() {
  "use strict";
  var definition = null, params = new URLSearchParams(location.search);

  window.Module = { register: function(name, module) { definition = module; } };

  if (params.get("at")) {
    var offset = Date.parse(params.get("at")) - Date.now(), realNow = Date.now;
    Date.now = function() { return realNow() + offset; };
  }

  function instance(container, overrides, pin) {
    var module = Object.create(definition);
    // No quiet hours in the demo, so it rotates whenever you look at it.
    module.config = Object.assign({}, definition.defaults, { quietHours: null }, overrides);
    if (pin) module.config.rotateInterval = 1e9;
    module.file = function(name) { return "/" + name; };
    module.updateDom = function(speed) {
      var swap = function() {
        container.innerHTML = "";
        container.appendChild(module.getDom());
        container.style.opacity = 1;
      };
      if (!speed) return swap();
      container.style.transition = "opacity " + speed / 2 + "ms";
      container.style.opacity = 0;
      setTimeout(swap, speed / 2);
    };
    module.sendSocketNotification = function() {
      fetch("/data?now=" + Date.now()).then(function(r) { return r.json(); }).then(function(data) {
        module.socketNotificationReceived("GLANCE_DATA", data);
        if (pin) module.index = Math.max(0, module.available().indexOf(pin));
        module.updateDom(0);
      });
    };
    module.start();
    module.updateDom(0);
    return module;
  }

  window.GlanceDemo = {
    start: function() {
      var modules = document.getElementById("modules"), cards = ["sky", "lake", "upcoming", "wine"];
      var pins = params.has("grid") ? cards : [params.get("card")];
      if (params.has("grid")) modules.className = "grid";
      pins.forEach(function(pin) {
        var wrapper = document.createElement("div");
        wrapper.className = "module MMM-Glance";
        if (pin) wrapper.id = "card-" + pin;
        var content = document.createElement("div");
        content.className = "module-content";
        wrapper.appendChild(content);
        modules.appendChild(wrapper);
        instance(content, {}, pin);
      });
    }
  };
}());
