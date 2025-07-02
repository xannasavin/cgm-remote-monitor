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

          // Create unique IDs for the elements for this plugin instance
          const systemPromptId = `ai_system_prompt_${plugin.name}`;
          const userPromptTemplateId = `ai_user_prompt_template_${plugin.name}`;

          // HTML for the form, using unique IDs
          // Using jQuery to build the form elements to ensure proper context if $ is later reassigned.
          const $formContainer = $('<div>'); // Create a container for our form elements

          $formContainer.append(
            $('<div>').css('margin-bottom', '15px').append(
              $('<label>').attr('for', systemPromptId).css({display: 'block', marginBottom: '5px'}).text('System Prompt: (Raw Test)'), // Temporarily use raw string
              $('<textarea>').attr('id', systemPromptId).attr('rows', 5).css({width: '90%', fontFamily: 'monospace'}).attr('placeholder', client.translate('e.g., You are a helpful assistant specializing in diabetes data analysis.'))
            )
          );

          $formContainer.append(
            $('<div>').css('margin-bottom', '15px').append(
              $('<label>').attr('for', userPromptTemplateId).css({display: 'block', marginBottom: '5px'}).text(client.translate('User Prompt Template (use {{CGMDATA}} for data insertion):')),
              $('<textarea>').attr('id', userPromptTemplateId).attr('rows', 10).css({width: '90%', fontFamily: 'monospace'}).attr('placeholder', client.translate('e.g., Analyze the following CGM data: {{CGMDATA}}. Provide insights on patterns and suggest improvements.'))
            )
          );

          $formContainer.append(
            $('<p>').append($('<em>').text(client.translate('Note: The {{CGMDATA}} token will be replaced with the actual JSON data from the selected report period when the AI evaluation is generated.')))
          );

          // Inject the form and get direct references to the textareas
          $(placeholderId).empty().append($formContainer);

          const $systemPromptEl = $formContainer.find('#' + systemPromptId);
          const $userPromptEl = $formContainer.find('#' + userPromptTemplateId);

          // Fetch current prompts
          $.ajax({ // Still using $ which is client.jquery
            url: client.settings.baseURL + '/api/v1/ai_settings/prompts',
            type: 'GET',
            headers: client.headers(),
            success: function(data) {
              if ($systemPromptEl.length) {
                $systemPromptEl.val(data.system_prompt || '');
              } else {
                console.error("Admin AI Settings: #" + systemPromptId + " not found after injection.");
              }
              if ($userPromptEl.length) {
                $userPromptEl.val(data.user_prompt_template || '');
              } else {
                console.error("Admin AI Settings: #" + userPromptTemplateId + " not found after injection.");
              }
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

          // Use the unique IDs to get values
          const systemPromptId = `ai_system_prompt_${plugin.name}`;
          const userPromptTemplateId = `ai_user_prompt_template_${plugin.name}`;
          const systemPrompt = $('#' + systemPromptId).val();
          const userPromptTemplate = $('#' + userPromptTemplateId).val();

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
