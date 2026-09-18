/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log', 'N/runtime', 'N/email', 'N/url'], function(record, log, runtime, email, url) {

    function afterSubmit(scriptContext) {

        var currentUserID = runtime.getCurrentUser().id;
        var desiredUserID = 4385;
        var whitelistUserIDs = [4385, 6, 4663, 5773, 12096, 8069, 148, 17698, 6802, 953, 20424, 21828]; // Replace with actual user IDs in your whitelist


        // Check if the operation is CREATE, or EDIT and the user is not in the whitelist
        if (!(scriptContext.type === scriptContext.UserEventType.CREATE ||
            (scriptContext.type === scriptContext.UserEventType.EDIT && !whitelistUserIDs.includes(currentUserID)))) {
            log.debug('afterSubmit', 'Exiting script because the operation is not allowed for this user and event type.');
            return;
        }
        var contextNewRec = scriptContext.newRecord;




        var newRecord = record.load({
            type: record.Type.ITEM_RECEIPT,
            id: contextNewRec.id,
            isDynamic: false,
        });

        log.debug('afterSubmit', 'Context New Record ID: ' + newRecord.id);


        var createdFrom = newRecord.getValue({ fieldId: 'createdfrom' });
        var transferLocation = newRecord.getValue({ fieldId: 'transferlocation' });
        var tranDate = newRecord.getValue({ fieldId: 'trandate' });

        log.debug('afterSubmit', newRecord.getFields());
        log.debug('afterSubmit', createdFrom);
        log.debug('afterSubmit', transferLocation);
        log.debug('afterSubmit', tranDate);


        var itemcount = newRecord.getLineCount({
            sublistId: 'item'
        });
        var rawMaterialsCount = 0;


        if(transferLocation != null) {
            log.debug('afterSubmit', transferLocation);
            return;

        }

        for (var x = 0; x < itemcount; x++) {
            var item = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: x
            });

            // Load the item record using the line_item_id
            var itemRecord = record.load({
                type: record.Type.INVENTORY_ITEM, // Replace with the correct record type if different
                id: item
            });

            // Get the value of the custitem_h_berp_itemtype field
            var item_type = itemRecord.getValue({
                fieldId: 'custitem_h_berp_itemtype'
            });

            if ( item_type != 6) {
                log.debug('afterSubmit', 'Item Type ' + item_type + ' is not Raw Materials Inventory');
                continue;
            }
            rawMaterialsCount += 1;

            var subrec = newRecord.getSublistSubrecord({
                sublistId: 'item',
                fieldId: 'inventorydetail',
                line: x
            });

            if (subrec) {
                var itemdetcount = subrec.getLineCount({
                    sublistId: 'inventoryassignment'
                });

                for (var z = 0; z < itemdetcount; z++) {
                    var beforeSettingStatus = subrec.getSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'inventorystatus',
                        line: z
                    });

                    subrec.setSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'inventorystatus',
                        value: 2,
                        line: z
                    });

                    var afterSettingStatus = subrec.getSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'inventorystatus',
                        line: z
                    });
                }
            }
        }

        newRecord.save();

        // Send email if raw materials are present
        if (rawMaterialsCount > 0) {
            log.debug('afterSubmit', 'Raw Material present.');



            var itTranId = newRecord.getValue({ fieldId: 'tranid' });
            var recordUrl = url.resolveRecord({
                recordType: 'itemreceipt',
                recordId: newRecord.id,
                isEditMode: false
            });
            var fullUrl = 'https://system.netsuite.com' + recordUrl;

            try {
                email.send({
                    author: currentUserID, 
                    recipients: 'raw-ingredient-receipt-verification@fedupfoods.co', 
                    subject: 'New Raw Material Ingredient on Item Receipt #' + itTranId,
                    body: 'Please review the following TRANSACTION: <a href="' + fullUrl + '">View Transaction</a>'
                });
                log.debug('afterSubmit', 'Email sent successfully.');
            } catch (e) {
                log.error('afterSubmit', 'Error sending email: ' + e.message);
            }
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
