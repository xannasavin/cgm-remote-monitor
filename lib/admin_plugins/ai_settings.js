'use strict';

// Admin plugin for AI Prompt Settings
function init(ctx) {
  // ctx provides access to Nightscout client utilities, $, etc.
  // However, admin plugins primarily define structure and actions.
  // Client-side JS for dynamic behavior is usually handled in the `init` function of an action or a general script part.

  const plugin = {
    name: 'AISettingsAdmin', // Unique name for the admin plugin
    label: 'AI Evaluation Prompt Settings', // Label for the fieldset in Admin tools

    // Admin plugins are structured around "actions". We'll use one main action
    // to display and manage the prompt settings form.
    actions: [
      {
        name: 'Configure AI Prompts', // Title for this section within the fieldset
        description: 'Set the system prompt and user prompt template for AI evaluations. Use {{CGMDATA}} in the User Prompt Template to insert CGM data.',
        buttonLabel: 'Save Prompts', // This button will be part of custom HTML, so this might not be directly used if we have one save button for multiple fields. Or, we can make it trigger the save.

        // `init` is called when the admin page loads and this action is rendered.
        // We'll use this to fetch initial data and set up handlers.
        init: function(client) { // client is Nightscout.client
          const $ = client.jquery; // Get jQuery from client context
          const placeholderId = `#admin_${plugin.name}_0_html`; // Derived from plugin name and action index
          const statusId = `#admin_${plugin.name}_0_status`;

          // HTML for the form
          const formHtml = `
            <div style="margin-bottom: 15px;">
              <label for="ai_system_prompt" style="display: block; margin-bottom: 5px;">${client.translate('System Prompt:')}</label>
              <textarea id="ai_system_prompt" rows="5" style="width: 90%; font-family: monospace;" placeholder="${client.translate('e.g., You are a helpful assistant specializing in diabetes data analysis.')}"></textarea>
            </div>
            <div style="margin-bottom: 15px;">
              <label for="ai_user_prompt_template" style="display: block; margin-bottom: 5px;">${client.translate('User Prompt Template (use {{CGMDATA}} for data insertion):')}</label>
              <textarea id="ai_user_prompt_template" rows="10" style="width: 90%; font-family: monospace;" placeholder="${client.translate('e.g., Analyze the following CGM data: {{CGMDATA}}. Provide insights on patterns and suggest improvements.')}"></textarea>
            </div>
            <p><em>${client.translate('Note: The {{CGMDATA}} token will be replaced with the actual JSON data from the selected report period when the AI evaluation is generated.')}</em></p>
          `;
          $(placeholderId).html(formHtml);

          // Fetch current prompts
          $.ajax({
            url: client.settings.baseURL + '/api/v1/ai_settings/prompts',
            type: 'GET',
            headers: client.headers(),
            success: function(data) {
              $('#ai_system_prompt').val(data.system_prompt || '');
              $('#ai_user_prompt_template').val(data.user_prompt_template || '');
            },
            error: function(jqXHR, textStatus, errorThrown) {
              console.error("Error fetching AI prompts:", textStatus, errorThrown);
              $(statusId).html(`<span style="color: red;">${client.translate('Error fetching prompts: ')} ${textStatus}</span>`);
            }
          });
        },

        // `code` is called when the action's button (defined by buttonLabel) is clicked.
        code: function(client) { // client is Nightscout.client
          const $ = client.jquery;
          const statusId = `#admin_${plugin.name}_0_status`;
          $(statusId).html(client.translate('Saving...'));

          const systemPrompt = $('#ai_system_prompt').val();
          const userPromptTemplate = $('#ai_user_prompt_template').val();

          $.ajax({
            url: client.settings.baseURL + '/api/v1/ai_settings/prompts',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
              system_prompt: systemPrompt,
              user_prompt_template: userPromptTemplate
            }),
            headers: client.headers(), // For authentication
            success: function(response) {
              $(statusId).html(`<span style="color: green;">${client.translate(response.message || 'Prompts saved successfully!')}</span>`);
              setTimeout(() => $(statusId).html(''), 3000); // Clear status after 3s
            },
            error: function(jqXHR, textStatus, errorThrown) {
              console.error("Error saving AI prompts:", textStatus, errorThrown, jqXHR.responseText);
              let errorDetail = textStatus;
              if (jqXHR.responseJSON && jqXHR.responseJSON.error) {
                errorDetail = client.translate(jqXHR.responseJSON.error);
                 if (jqXHR.responseJSON.details) errorDetail += `: ${client.translate(jqXHR.responseJSON.details)}`;
              }
              $(statusId).html(`<span style="color: red;">${client.translate('Error saving prompts: ')} ${errorDetail}</span>`);
            }
          });
        }
      }
    ]
  };

  return plugin;
}

module.exports = init;
