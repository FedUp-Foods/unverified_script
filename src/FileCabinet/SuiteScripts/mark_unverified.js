/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log', 'N/runtime', 'N/email', 'N/url', 'N/search'],
    function(record, log, runtime, email, url, search) {

        function afterSubmit(scriptContext) {

            var currentUserID = runtime.getCurrentUser().id;
            var whitelistUserIDs = [4385, 6, 4663, 5773, 12096, 8069, 148, 17698, 6802, 953, 20424, 21828];

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
                isDynamic: false
            });

            log.debug('afterSubmit', 'Context New Record ID: ' + newRecord.id);

            var createdFrom = newRecord.getValue({ fieldId: 'createdfrom' });
            var transferLocation = newRecord.getValue({ fieldId: 'transferlocation' });
            var tranDate = newRecord.getValue({ fieldId: 'trandate' });

            log.debug('afterSubmit createdFrom', createdFrom);
            log.debug('afterSubmit transferLocation', transferLocation);
            log.debug('afterSubmit tranDate', tranDate);

            var itemcount = newRecord.getLineCount({
                sublistId: 'item'
            });

            var rawMaterialsCount = 0;
            var statusWasUpdated = false;

            if (transferLocation != null && transferLocation !== '') {
                log.debug('afterSubmit', 'Transfer receipt detected. Exiting. Transfer Location: ' + transferLocation);
                return;
            }

            for (var x = 0; x < itemcount; x++) {

                var itemId = newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: x
                });

                if (!itemId) {
                    log.debug('afterSubmit', 'Skipping line ' + x + ' because item is empty.');
                    continue;
                }

                var itemLookup;

                try {
                    itemLookup = search.lookupFields({
                        type: search.Type.ITEM,
                        id: itemId,
                        columns: ['recordtype', 'custitem_h_berp_itemtype']
                    });
                } catch (e) {
                    log.error('afterSubmit', 'Unable to look up item ' + itemId + ' on line ' + x + ': ' + e.message);
                    continue;
                }

                var itemRecordType = itemLookup.recordtype;
                var itemTypeValue = null;

                if (itemLookup.custitem_h_berp_itemtype && itemLookup.custitem_h_berp_itemtype.length > 0) {
                    itemTypeValue = itemLookup.custitem_h_berp_itemtype[0].value;
                }

                // Copacking fee / landed-cost style lines are usually otherchargeitem.
                // They do not have inventory detail and should not be processed by this script.
                if (itemRecordType === 'otherchargeitem') {
                    log.debug('afterSubmit', 'Skipping Other Charge item on line ' + x + ', item ID ' + itemId);
                    continue;
                }

                // Only inventory-type items can reasonably have inventory detail/status.
                var inventoryRecordTypes = [
                    'inventoryitem',
                    'lotnumberedinventoryitem',
                    'serializedinventoryitem'
                ];

                if (!inventoryRecordTypes.includes(itemRecordType)) {
                    log.debug(
                        'afterSubmit',
                        'Skipping non-inventory item on line ' + x +
                        '. Item ID: ' + itemId +
                        ', record type: ' + itemRecordType
                    );
                    continue;
                }

                // Raw Materials Inventory = 6
                if (String(itemTypeValue) !== '6') {
                    log.debug(
                        'afterSubmit',
                        'Skipping inventory item that is not Raw Materials Inventory. Line: ' + x +
                        ', item ID: ' + itemId +
                        ', item type: ' + itemTypeValue
                    );
                    continue;
                }

                var subrec;

                try {
                    subrec = newRecord.getSublistSubrecord({
                        sublistId: 'item',
                        fieldId: 'inventorydetail',
                        line: x
                    });
                } catch (e) {
                    log.debug(
                        'afterSubmit',
                        'Raw material line has no inventory detail. Skipping line ' + x +
                        ', item ID ' + itemId +
                        '. Error: ' + e.message
                    );
                    continue;
                }

                if (!subrec) {
                    log.debug('afterSubmit', 'No inventory detail found for raw material line ' + x + ', item ID ' + itemId);
                    continue;
                }

                var itemdetcount = subrec.getLineCount({
                    sublistId: 'inventoryassignment'
                });

                if (itemdetcount <= 0) {
                    log.debug('afterSubmit', 'No inventory assignments found for raw material line ' + x + ', item ID ' + itemId);
                    continue;
                }

                rawMaterialsCount += 1;

                for (var z = 0; z < itemdetcount; z++) {

                    var beforeSettingStatus = subrec.getSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'inventorystatus',
                        line: z
                    });

                    // 2 = Unverified
                    if (String(beforeSettingStatus) !== '2') {
                        subrec.setSublistValue({
                            sublistId: 'inventoryassignment',
                            fieldId: 'inventorystatus',
                            value: 2,
                            line: z
                        });

                        statusWasUpdated = true;

                        log.debug(
                            'afterSubmit',
                            'Set inventory status to Unverified for item ' + itemId +
                            ', item receipt line ' + x +
                            ', inventory assignment line ' + z
                        );
                    }
                }
            }

            if (statusWasUpdated) {
                newRecord.save();
                log.debug('afterSubmit', 'Item Receipt saved after updating raw material inventory statuses.');
            } else {
                log.debug('afterSubmit', 'No raw material inventory statuses needed updating. Record was not saved.');
            }

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