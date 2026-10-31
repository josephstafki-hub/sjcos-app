/** Never expose provider diagnostics or card details to the client. */
export function paymentDeclineMessage(code: string): string {
  switch (code) {
    case "INSUFFICIENT_FUNDS": return "Your bank declined this payment because there aren't enough funds. Try another payment method or contact your bank.";
    case "CARD_EXPIRED": case "EXPIRATION_FAILURE": return "This card has expired. Use another card.";
    case "CVV_FAILURE": case "VERIFY_CVV_FAILURE": return "The card security code didn't match. Check the code and try again.";
    case "ADDRESS_VERIFICATION_FAILURE": return "The billing address didn't match. Check the address and try again.";
    case "INVALID_ACCOUNT": case "INVALID_ACCOUNT_NUMBER": return "The bank account couldn't be verified. Check the account details or message Joe for another way to pay.";
    default: return "The payment wasn't accepted. Try another payment method or message Joe for help.";
  }
}
