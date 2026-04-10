'use strict';

// Admin plugin for AI Usage Statistics
function init(ctx) {
    const pluginName = 'AIUsageViewerAdmin';

    // Helper functions defined in a shared scope
    const renderUsageTable = (client, placeholderId, data) => {
        const $ = window.jQuery;
        const monthlyData = data.monthly || [];
        const totalData = data.total || {};
        const exchangeRateInfo = data.exchangeRateInfo;

        if (monthlyData.length === 0) {
            $(placeholderId).html(`<p>${client.translate('No AI usage data available yet.')}</p>`);
            return;
        }

        let costHeaders = `<th class="exchange-rate exchange-rate-usd" colspan="3">${client.translate('Costs (USD)')}</th>`;
        if (exchangeRateInfo) {
            costHeaders += `<th class="exchange-rate exchange-rate-foreign" colspan="3">${client.translate('Costs')} (${exchangeRateInfo.currency})</th>`;
        }

        let tableHtml = `
      <table class="table-ai-usage" style="width: auto; border-collapse: collapse;">
        <thead>
          <tr>
            <th rowspan="2" style="vertical-align: bottom;">${client.translate('Month')}</th>
            <th rowspan="2" style="vertical-align: bottom;">${client.translate('Requests')}</th>
            <th rowspan="2" style="vertical-align: bottom;">${client.translate('Total Days')}</th>
            <th rowspan="2" style="vertical-align: bottom;">${client.translate('Avg Days/Req')}</th>
            <th colspan="2">${client.translate('Repair Calls')}</th>
            <th colspan="3">${client.translate('Total Tokens')}</th>
            <th colspan="3">${client.translate('Avg Tokens/Req')}</th>
            <th colspan="3">${client.translate('Avg Tokens/Day')}</th>
            ${costHeaders}
          </tr>
          <tr>
            <th>${client.translate('Total')}</th>
            <th>${client.translate('Avg/Req')}</th>
            <th>${client.translate('Input')}</th>
            <th>${client.translate('Output')}</th>
            <th>${client.translate('Total')}</th>
            <th>${client.translate('Input')}</th>
            <th>${client.translate('Output')}</th>
            <th>${client.translate('Total')}</th>
            <th>${client.translate('Input')}</th>
            <th>${client.translate('Output')}</th>
            <th>${client.translate('Total')}</th>
            <th class="exchange-rate exchange-rate-usd">${client.translate('Total')}</th>
            <th class="exchange-rate exchange-rate-usd">${client.translate('Avg/Req')}</th>
            <th class="exchange-rate exchange-rate-usd">${client.translate('Avg/Day')}</th>
            ${exchangeRateInfo ? `
            <th class="exchange-rate exchange-rate-foreign">${client.translate('Total')}</th>
            <th class="exchange-rate exchange-rate-foreign">${client.translate('Avg/Req')}</th>
            <th class="exchange-rate exchange-rate-foreign">${client.translate('Avg/Day')}</th>
            ` : ''}
          </tr>
        </thead>
        <tbody>
    `;

        monthlyData.forEach(function (monthEntry) {
            let costCells = `
          <td class="exchange-rate exchange-rate-usd">$${parseFloat(monthEntry.total_costs || 0).toFixed(4)}</td>
          <td class="exchange-rate exchange-rate-usd">$${parseFloat(monthEntry.avg_costs_per_request || 0).toFixed(4)}</td>
          <td class="exchange-rate exchange-rate-usd">$${parseFloat(monthEntry.avg_costs_per_day_requested || 0).toFixed(4)}</td>
      `;
            if (exchangeRateInfo) {
                const currency = exchangeRateInfo.currency.toLowerCase();
                costCells += `
            <td class="exchange-rate exchange-rate-foreign">${parseFloat(monthEntry['total_costs_' + currency] || 0).toFixed(4)}</td>
            <td class="exchange-rate exchange-rate-foreign">${parseFloat(monthEntry['avg_costs_per_request_' + currency] || 0).toFixed(4)}</td>
            <td class="exchange-rate exchange-rate-foreign">${parseFloat(monthEntry['avg_costs_per_day_requested_' + currency] || 0).toFixed(4)}</td>
        `;
            }

            tableHtml += `
        <tr>
          <td>${monthEntry.month}</td>
          <td>${monthEntry.requests}</td>
          <td>${monthEntry.total_days_requested}</td>
          <td>${parseFloat(monthEntry.avg_days_per_request).toFixed(2)}</td>

          <td>${monthEntry.total_repair_calls || 0}</td>
          <td>${parseFloat(monthEntry.avg_repair_calls_per_request || 0).toFixed(2)}</td>

          <td>${monthEntry.total_prompt_tokens}</td>
          <td>${monthEntry.total_completion_tokens}</td>
          <td>${monthEntry.total_tokens}</td>

          <td>${parseFloat(monthEntry.avg_prompt_tokens_per_request).toFixed(0)}</td>
          <td>${parseFloat(monthEntry.avg_completion_tokens_per_request).toFixed(0)}</td>
          <td>${parseFloat(monthEntry.avg_tokens_per_request).toFixed(0)}</td>

          <td>${parseFloat(monthEntry.avg_prompt_tokens_per_day).toFixed(0)}</td>
          <td>${parseFloat(monthEntry.avg_completion_tokens_per_day).toFixed(0)}</td>
          <td>${parseFloat(monthEntry.avg_tokens_per_day).toFixed(0)}</td>

          ${costCells}
        </tr>
      `;
        });

        let totalCostCells = `
            <td class="exchange-rate exchange-rate-usd">$${parseFloat(totalData.total_costs || 0).toFixed(4)}</td>
            <td class="exchange-rate exchange-rate-usd">$${parseFloat(totalData.avg_costs_per_request || 0).toFixed(4)}</td>
            <td class="exchange-rate exchange-rate-usd">$${parseFloat(totalData.avg_costs_per_day_requested || 0).toFixed(4)}</td>
      `;

        if (exchangeRateInfo) {
            const currency = exchangeRateInfo.currency.toLowerCase();
            totalCostCells += `
            <td class="exchange-rate exchange-rate-foreign">${parseFloat(totalData['total_costs_' + currency] || 0).toFixed(4)}</td>
            <td class="exchange-rate exchange-rate-foreign">${parseFloat(totalData['avg_costs_per_request_' + currency] || 0).toFixed(4)}</td>
            <td class="exchange-rate exchange-rate-foreign">${parseFloat(totalData['avg_costs_per_day_requested_' + currency] || 0).toFixed(4)}</td>
        `;
        }

        tableHtml += `
        </tbody>
        <tfoot>
          <tr style="font-weight: bold;">
            <td>${client.translate('Total')}</td>
            <td>${totalData.requests || 0}</td>
            <td>${totalData.total_days_requested || 0}</td>
            <td>${parseFloat(totalData.avg_days_per_request || 0).toFixed(2)}</td>

            <td>${totalData.total_repair_calls || 0}</td>
            <td>${parseFloat(totalData.avg_repair_calls_per_request || 0).toFixed(2)}</td>

            <td>${totalData.total_prompt_tokens || 0}</td>
            <td>${totalData.total_completion_tokens || 0}</td>
            <td>${totalData.total_tokens || 0}</td>

            <td>${parseFloat(totalData.avg_prompt_tokens_per_request || 0).toFixed(0)}</td>
            <td>${parseFloat(totalData.avg_completion_tokens_per_request || 0).toFixed(0)}</td>
            <td>${parseFloat(totalData.avg_tokens_per_request || 0).toFixed(0)}</td>

            <td>${parseFloat(totalData.avg_prompt_tokens_per_day || 0).toFixed(0)}</td>
            <td>${parseFloat(totalData.avg_completion_tokens_per_day || 0).toFixed(0)}</td>
            <td>${parseFloat(totalData.avg_tokens_per_day || 0).toFixed(0)}</td>

            ${totalCostCells}
          </tr>
        </tfoot>
      </table>
      <p><em>${client.translate('Note: Token counts are based on information returned by the LLM API.')}</em></p>
      `;

        if (exchangeRateInfo) {
            tableHtml += `<p><em>${client.translate('Currency conversion is activated via AI_LLM_EXCHANGERATE_API_CURRENCY - make sure AI_LLM_EXCHANGERATE_API_KEY is set. Exchange rate (1 USD = %2 %1)', { params: [exchangeRateInfo.currency, exchangeRateInfo.rate.toFixed(4)] })}</em></p>`;
        } else if (client.settings.ai_llm_exchangerate_api_currency) {
            tableHtml += `<p style="color:red;"><em>${client.translate('Currency conversion is enabled via AI_LLM_EXCHANGERATE_API_CURRENCY, but it seems there is no result from that endpoint. Check if AI_LLM_EXCHANGERATE_API_KEY is set.')}</em></p>`;
        }

        tableHtml += `
      <style>
         .table-ai-usage {
           margin: 20px 0;
         }
        .table-ai-usage th, 
        .table-ai-usage td {
            padding: 10px;
            text-align: left;
            min-width: 80px;
            border: 1px solid;
        }
        .table-ai-usage tr:nth-child(even) {
            background-color: lightslategrey;
            color: black;
        }
        .table-ai-usage th,
         .table-ai-usage tfoot td {
            background-color: lightskyblue;
            color: black;
        }
        .table-ai-usage th.exchange-rate,
        .table-ai-usage tfoot td.exchange-rate  {
            background-color: coral;
            color: black;
        } 
        .table-ai-usage .exchange-rate {
        
        } 
        .table-ai-usage .exchange-rate .exchange-rate-foreign {
        
        }
        .table-ai-usage .exchange-rate .exchange-rate-usd {
        
        }
      </style>
    `;
        $(placeholderId).html(tableHtml);
    };

    const fetchUsageData = (client, placeholderId, statusId) => {
        const $ = window.jQuery;
        $(statusId).html(client.translate('Loading usage data...'));
        $(placeholderId).empty();

        $.ajax({
            url: client.settings.baseURL + '/api/v1/ai_usage/monthly_summary',
            type: 'GET',
            headers: client.headers(),
            success: function (data) {
                $(statusId).html('');
                renderUsageTable(client, placeholderId, data);
            },
            error: function (jqXHR, textStatus, errorThrown) {
                console.error("AI Eval: [Admin] Error fetching AI usage summary:", textStatus, errorThrown);
                $(statusId).html('');
                $(placeholderId).html(`<p style="color: red;">${client.translate('Error fetching AI usage data: ')} ${textStatus}</p><p>${client.translate('Ensure you have appropriate permissions (e.g., admin or a role with api:treatments:read).')}</p>`);
            }
        });
    };


    const plugin = {
        name: pluginName,
        label: 'AI Usage Statistics',
        actions: [
            {
                name: 'View Monthly Usage',
                description: 'Displays monthly token consumption and API call counts for the AI Evaluation feature.',

                init: function (client) {
                    const $ = window.jQuery;
                    if (typeof $ !== 'function') {
                        console.error('AI Eval: [Admin] jQuery is not available!');
                        return;
                    }
                    const placeholderId = `#admin_${pluginName}_0_html`;
                    const statusId = `#admin_${pluginName}_0_status`;
                    fetchUsageData(client, placeholderId, statusId);
                }
            },
            {
                name: 'Recalculate Summary',
                description: 'Recalculates the summary data from the raw usage statistics. Use this if you suspect the summary is out of sync.',
                buttonLabel: 'Recalculate Summary',

                code: function (client) {
                    const $ = window.jQuery;
                    const statusId = `#admin_${pluginName}_1_status`;
                    $(statusId).html(client.translate('Recalculating...'));
                    $.ajax({
                        url: client.settings.baseURL + '/api/v1/ai_usage/rebuild_summary',
                        type: 'POST',
                        headers: client.headers(),
                        success: function (data) {
                            $(statusId).html(`<span style="color: green;">${client.translate(data.message)}</span>`);
                            // Refresh the main view
                            const placeholderId = `#admin_${pluginName}_0_html`;
                            const mainStatusId = `#admin_${pluginName}_0_status`;
                            fetchUsageData(client, placeholderId, mainStatusId);
                        },
                        error: function (jqXHR, textStatus, errorThrown) {
                            $(statusId).html(`<span style="color: red;">${client.translate('Error recalculating summary: ')} ${textStatus}</span>`);
                        }
                    });
                }
            },
            {
                name: 'Delete Old Data',
                description: 'Deletes all usage data older than a specified number of months.',
                buttonLabel: 'Delete Data'
            }
        ]
    };

    plugin.actions[2].init = function (client) {
        const $ = window.jQuery;
        const inputId = `admin_${pluginName}_2_months`;
        const label = $('<label>').attr('for', inputId).text(client.translate('Delete data older than (months): '));
        const input = $('<input>').attr('type', 'number').attr('id', inputId).attr('min', '1').val('6');
        $(`#admin_${pluginName}_2_html`).html($('<div>').append(label).append(input));
    };

    plugin.actions[2].code = function (client) {
        const $ = window.jQuery;
        const statusId = `#admin_${pluginName}_2_status`;
        const months = $(`#admin_${pluginName}_2_months`).val();

        if (!months || parseInt(months) < 1) {
            $(statusId).html(`<span style="color: red;">${client.translate('Please enter a valid number of months.')}</span>`);
            return;
        }

        if (!confirm(client.translate('Are you sure you want to delete all AI usage data older than %1 months? This action cannot be undone.', { params: [months] }))) {
            return;
        }

        $(statusId).html(client.translate('Deleting old data...'));
        $.ajax({
            url: client.settings.baseURL + '/api/v1/ai_usage/delete_old',
            type: 'POST',
            headers: client.headers(),
            contentType: 'application/json',
            data: JSON.stringify({ months: parseInt(months) }),
            success: function (data) {
                $(statusId).html(`<span style="color: green;">${client.translate(data.message)}</span>`);
                // Refresh the main view
                const placeholderId = `#admin_${pluginName}_0_html`;
                const mainStatusId = `#admin_${pluginName}_0_status`;
                fetchUsageData(client, placeholderId, mainStatusId);
            },
            error: function (jqXHR, textStatus, errorThrown) {
                $(statusId).html(`<span style="color: red;">${client.translate('Error deleting old data: ')} ${textStatus}</span>`);
            }
        });
    };

    return plugin;
}

module.exports = init;
