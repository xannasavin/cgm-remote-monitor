'use strict';

// Admin plugin for AI Usage Statistics
function init(ctx) {
  const plugin = {
    name: 'AIUsageViewerAdmin',
    label: 'AI Usage Statistics',

    actions: [
      {
        name: 'View Monthly Usage',
        description: 'Displays monthly token consumption and API call counts for the AI Evaluation feature.',
        // No button needed for just viewing data, a refresh might be added later.
        // buttonLabel: 'Refresh Data',

        init: function(client) {
          const $ = window.jQuery;
          if (typeof $ !== 'function') {
            console.error('[AIUsageViewerAdmin] jQuery is not available!');
            const placeholderIdForError = `#admin_${plugin.name}_0_html`;
            if (document.querySelector(placeholderIdForError)) {
                 document.querySelector(placeholderIdForError).innerHTML = '<p style="color:red;">Error: jQuery not available. AI Usage UI cannot load.</p>';
            }
            return;
          }

          const placeholderId = `#admin_${plugin.name}_0_html`;
          const statusId = `#admin_${plugin.name}_0_status`; // For loading messages or errors

          function renderUsageTable(data) {
            if (!data || data.length === 0) {
              $(placeholderId).html(`<p>${client.translate('No AI usage data available yet.')}</p>`);
              return;
            }

            let tableHtml = `
              <table class="table table-striped table-bordered" style="width: auto;">
                <thead>
                  <tr>
                    <th>${client.translate('Month (YYYY-MM)')}</th>
                    <th>${client.translate('Total Tokens Consumed')}</th>
                    <th>${client.translate('Total API Calls')}</th>
                    <th>${client.translate('Last Updated (UTC)')}</th>
                  </tr>
                </thead>
                <tbody>
            `;

            data.forEach(function(monthEntry) {
              tableHtml += `
                <tr>
                  <td>${client.escape(monthEntry._id)}</td>
                  <td>${client.escape(monthEntry.total_tokens_month || 0)}</td>
                  <td>${client.escape(monthEntry.api_calls_month || 0)}</td>
                  <td>${monthEntry.last_updated ? client.escape(new Date(monthEntry.last_updated).toISOString()) : client.translate('N/A')}</td>
                </tr>
              `;
            });

            tableHtml += `
                </tbody>
              </table>
              <p><em>${client.translate('Note: Token counts are based on information returned by the LLM API (e.g., OpenAI). Cost estimation is not yet implemented in this view.')}</em></p>
            `;
            $(placeholderId).html(tableHtml);
          }

          function fetchUsageData() {
            $(statusId).html(client.translate('Loading usage data...'));
            $(placeholderId).empty();

            $.ajax({
              url: client.settings.baseURL + '/api/v1/ai_usage/monthly_summary',
              type: 'GET',
              headers: client.headers(), // Important for authentication
              success: function(data) {
                $(statusId).html(''); // Clear loading message
                renderUsageTable(data);
              },
              error: function(jqXHR, textStatus, errorThrown) {
                console.error("Error fetching AI usage summary:", textStatus, errorThrown);
                $(statusId).html('');
                $(placeholderId).html(`<p style="color: red;">${client.translate('Error fetching AI usage data: ')} ${client.escape(textStatus)}</p><p>${client.translate('Ensure you have appropriate permissions (e.g., admin or a role with api:treatments:read).')}</p>`);
              }
            });
          }

          // Initial data fetch
          fetchUsageData();

          // If we had a refresh button:
          // const $refreshButton = $('<button class="btn btn-secondary" style="margin-top:10px;">').text(client.translate('Refresh Data'));
          // $refreshButton.on('click', fetchUsageData);
          // $(placeholderId).after($refreshButton); // Or append it somewhere logical
        },

        // 'code' function would be used if we had a buttonLabel and an action to perform on click.
        // Since this is view-only for now, it's not strictly necessary unless we add a manual refresh button
        // that we want to handle through this standard admin plugin structure.
        // code: function(client) {
        //   // This would be triggered if a button defined by 'buttonLabel' was clicked.
        //   // We are handling refresh inside init for now if we add one.
        // }
      }
    ]
  };

  return plugin;
}

module.exports = init;
