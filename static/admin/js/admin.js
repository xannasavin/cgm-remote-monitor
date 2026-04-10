(function () {
  'use strict';
  //for the tests window isn't the global object
  var Nightscout = window.Nightscout;
  var client = Nightscout.client;

  client.requiredPermission = '*';
  client.init(function loaded () {
    // Initialize admin plugins with client.ctx (has settings including ai_llm_key_is_set)
    var admin_plugins = Nightscout.admin_plugins_preinit(client.ctx);
    Nightscout.admin_plugins = admin_plugins;
    // init HTML code
    admin_plugins.createHTML( client );
  });

})();
