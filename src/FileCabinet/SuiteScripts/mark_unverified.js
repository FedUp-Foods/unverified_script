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