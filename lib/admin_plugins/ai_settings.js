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
        description: 'Set the system prompt and user prompt template for AI evaluations. Use {{CGMDATA}} and {{PROFILE}} in the User Prompt Template to insert CGM & PRofile data.',
        buttonLabel: 'Save Prompts', // This button will be part of custom HTML, so this might not be directly used if we have one save button for multiple fields. Or, we can make it trigger the save.

        // `init` is called when the admin page loads and this action is rendered.
        // We'll use this to fetch initial data and set up handlers.
        init: function(client) { // client is Nightscout.client
          const $ = window.jQuery; // Use window.jQuery directly

          if (typeof $ !== 'function') {
            console.error('[AISettingsAdmin] jQuery (window.jQuery) is not available or not a function!');
            // Optionally, display an error in the placeholder
            const placeholderIdForError = `#admin_${plugin.name}_0_html`;
            if (document.querySelector(placeholderIdForError)) {
              document.querySelector(placeholderIdForError).innerHTML = '<p style="color:red;">Error: jQuery not available. AI Settings UI cannot load.</p>';
            }
            return; // Stop if jQuery isn't there
          }

          const placeholderId = `#admin_${plugin.name}_0_html`; // Derived from plugin name and action index
          const statusId = `#admin_${plugin.name}_0_status`;

          // Create unique IDs for the elements for this plugin instance
          const systemInterimPromptId = `ai_system_interim_prompt_${plugin.name}`;
          const userInterimPromptTemplateId = `ai_user_interim_prompt_template_${plugin.name}`;
          const systemPromptId = `ai_system_prompt_${plugin.name}`;
          const userPromptTemplateId = `ai_user_prompt_template_${plugin.name}`;

          // HTML for the form, using unique IDs
          const $formContainer = $('<div>'); // Create a container for our form elements

          $formContainer.append(
              $('<div>').css('margin-bottom', '15px').append(
                  $('<label>').attr('for', systemInterimPromptId).css({display: 'block', marginBottom: '5px'}).text(client.translate('System Interim Prompt:')),
                  $('<textarea>').attr('id', systemInterimPromptId).attr('rows', 5).css({width: '90%', fontFamily: 'monospace'}).attr('placeholder', client.translate('e.g., You are a helpful assistant specializing in diabetes data analysis.'))
              )
          );

          $formContainer.append(
              $('<div>').css('margin-bottom', '15px').append(
                  $('<label>').attr('for', userInterimPromptTemplateId).css({display: 'block', marginBottom: '5px'}).text(client.translate('User Interim Prompt Template (use {{CGMDATA}} for data insertion):')),
                  $('<textarea>').attr('id', userInterimPromptTemplateId).attr('rows', 10).css({width: '90%', fontFamily: 'monospace'}).attr('placeholder', client.translate('e.g., Analyze the following CGM data: {{CGMDATA}}. Provide insights on patterns and suggest improvements.'))
              )
          );

          $formContainer.append(
              $('<div>').css('margin-bottom', '15px').append(
                  $('<label>').attr('for', systemPromptId).css({display: 'block', marginBottom: '5px'}).text(client.translate('System Prompt:')), // Reverted to use client.translate
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
              $('<p>').append($('<em>').text(client.translate('Note: The {{CGMDATA}} and {{PROFILE}} token will be replaced with the actual JSON data from the selected report period when the AI evaluation is generated.')))
          );

          // Inject the form and get direct references to the textareas
          $(placeholderId).empty().append($formContainer);

          const $systemInterimPromptEl = $formContainer.find('#' + systemInterimPromptId);
          const $userInterimPromptEl = $formContainer.find('#' + userInterimPromptTemplateId);
          const $systemPromptEl = $formContainer.find('#' + systemPromptId);
          const $userPromptEl = $formContainer.find('#' + userPromptTemplateId);

          // Fetch current prompts
          $.ajax({ // Still using $ which is client.jquery
            url: client.settings.baseURL + '/api/v1/ai_settings/prompts',
            type: 'GET',
            headers: client.headers(),
            success: function(data) {
              if ($systemInterimPromptEl.length) {
                $systemInterimPromptEl.val(data.system_interim_prompt || '');
              } else {
                console.error("Admin AI Settings: #" + systemInterimPromptId + " not found after injection.");
              }
              if ($userInterimPromptEl.length) {
                $userInterimPromptEl.val(data.user_interim_prompt_template || '');
              } else {
                console.error("Admin AI Settings: #" + userInterimPromptTemplateId + " not found after injection.");
              }
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
        // It now receives 'buttonElement' as the second argument from the generic admin handler
        code: function(client, buttonElement) {
          const $ = window.jQuery; // Use window.jQuery directly
          const $button = $(buttonElement); // jQuery wrapper for the button

          if (typeof $ !== 'function') {
            console.error('[AISettingsAdmin Save] jQuery (window.jQuery) is not available!');
            // Attempt to update statusId directly if possible, though $ might be needed for selector
            const statusIdForError = `admin_${plugin.name}_0_status`; // Raw ID
            if (document.getElementById(statusIdForError)) {
              document.getElementById(statusIdForError).innerHTML = '<span style="color:red;">Error: jQuery not available. Cannot save.</span>';
            }
            return;
          }

          const statusId = `#admin_${plugin.name}_0_status`;
          $(statusId).html(client.translate('Saving...'));

          // Use the unique IDs to get values
          const systemInterimPromptId = `ai_system_interim_prompt_${plugin.name}`;
          const userInterimPromptTemplateId = `ai_user_interim_prompt_template_${plugin.name}`;
          const systemPromptId = `ai_system_prompt_${plugin.name}`;
          const userPromptTemplateId = `ai_user_prompt_template_${plugin.name}`;
          const systemInterimPrompt = $('#' + systemInterimPromptId).val();
          const userInterimPromptTemplate = $('#' + userInterimPromptTemplateId).val();
          const systemPrompt = $('#' + systemPromptId).val();
          const userPromptTemplate = $('#' + userPromptTemplateId).val();

          let ajaxHeaders = {};
          if (client && typeof client.headers === 'function') {
            ajaxHeaders = client.headers();
            console.log('[AISettingsAdmin Save] Using client.headers.');
          } else {
            console.warn('[AISettingsAdmin Save] client.headers is not a function. Proceeding without custom headers.');
            // For admin actions, session cookies might be sufficient for auth.
            // If not, this will likely result in a 401 from the API.
          }

          $.ajax({
            url: client.settings.baseURL + '/api/v1/ai_settings/prompts',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
              system_interim_prompt: systemInterimPrompt,
              user_interim_prompt_template: userInterimPromptTemplate,
              system_prompt: systemPrompt,
              user_prompt_template: userPromptTemplate,
            }),
            headers: ajaxHeaders, // Use potentially modified ajaxHeaders
            success: function(response) {
              $(statusId).html(`<span style="color: green;">${client.translate(response.message || 'Prompts saved successfully!')}</span>`);
              setTimeout(() => {
                $(statusId).html('');
                $button.css('display', ''); // Re-show button
              }, 3000); // Clear status and show button after 3s
            },
            error: function(jqXHR, textStatus, errorThrown) {
              console.error("Error saving AI prompts:", textStatus, errorThrown, jqXHR.responseText);
              let errorDetail = textStatus;
              if (jqXHR.responseJSON && jqXHR.responseJSON.error) {
                errorDetail = client.translate(jqXHR.responseJSON.error);
                if (jqXHR.responseJSON.details) errorDetail += `: ${client.translate(jqXHR.responseJSON.details)}`;
              }
              $(statusId).html(`<span style="color: red;">${client.translate('Error saving prompts: ')} ${errorDetail}</span>`);
              // Also re-show button on error, perhaps after a slightly longer delay or immediately
              setTimeout(() => {
                // $(statusId).html(''); // Optionally clear error message too, or leave it.
                $button.css('display', ''); // Re-show button
              }, 5000); // Re-show button after 5s, giving time to read error
            }
          });
        }
      }
    ]
  };

  return plugin;
}

module.exports = init;
