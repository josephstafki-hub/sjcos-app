import { LegalPage } from "@/components/legal/LegalPage";

export const metadata = { title: "Privacy Policy · SJC OS" };

export default function PrivacyPage() {
  return (
    <LegalPage title="SJC OS Privacy Policy" effective="October 2, 2026">
      <p>SJC OS is a business management system operated by SJ Carpentry LLC (&ldquo;SJ Carpentry,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) of Circle Pines, Minnesota. This policy explains what information SJC OS handles, how we use it, and how it connects to QuickBooks Online.</p>

      <h2>1. What SJC OS is</h2>
      <p>SJC OS is an internal system used by SJ Carpentry LLC and its authorized team members to manage leads, projects, estimates, communications, and financial records. It is not offered to the general public, and you cannot create an account on your own.</p>

      <h2>2. Information we handle</h2>
      <ul>
        <li><strong>User account information:</strong> name, email address, and sign-in credentials for authorized team members.</li>
        <li><strong>Business records:</strong> information about leads, clients, projects, estimates, vendors, subcontractors, invoices, and expenses, as entered by us or provided to us in the course of our work.</li>
        <li><strong>Communications:</strong> emails and text messages sent or received through the system, including phone numbers and message content.</li>
        <li><strong>QuickBooks Online data:</strong> accounting records described in Section 3.</li>
      </ul>

      <h2>3. QuickBooks Online connection</h2>
      <p>An authorized SJ Carpentry user can connect SJC OS to the SJ Carpentry LLC QuickBooks Online company file through Intuit&rsquo;s sign-in and authorization screen. When connected, SJC OS requests the <code>com.intuit.quickbooks.accounting</code> permission and uses it only for the following purposes:</p>
      <ul>
        <li>Reading accounting records from SJ Carpentry&rsquo;s own company file, such as customers, vendors, invoices, bills, payments, expenses, and accounts.</li>
        <li>Where we turn the feature on, creating or updating matching records in that company file so that project records and books stay consistent.</li>
      </ul>
      <p>We store the connection credentials that Intuit issues (authorization tokens) so the connection can stay active. We do not use QuickBooks data for advertising, we do not sell it, and we do not use it for any purpose unrelated to running SJ Carpentry LLC. SJC OS connects only to company files that the account owner has authorized.</p>
      <p>You can disconnect SJC OS at any time from your Intuit account or from QuickBooks Online. When the connection is removed, SJC OS stops accessing the company file and we delete the stored tokens.</p>

      <h2>4. How we use information</h2>
      <ul>
        <li>To run SJ Carpentry LLC, including estimating, scheduling, bookkeeping, invoicing, and managing projects.</li>
        <li>To communicate with clients, vendors, and subcontractors.</li>
        <li>To keep the system secure and prevent misuse.</li>
        <li>To meet legal, tax, and accounting obligations.</li>
      </ul>

      <h2>5. How we share information</h2>
      <p>We do not sell personal information. We share information only with service providers that host or support SJC OS (for example, hosting, email delivery, text message delivery, and accounting through Intuit), when required by law, or with your consent.</p>
      <p>Mobile phone numbers and text message opt-in information are not shared with third parties or affiliates for marketing or promotional purposes.</p>

      <h2>6. Retention and deletion</h2>
      <p>We keep records for as long as needed to run the business and to meet tax, accounting, and legal requirements. You can ask us to delete personal information we hold about you, and we will do so unless we are required to keep it. Stored QuickBooks authorization tokens are deleted when the connection is removed.</p>

      <h2>7. Security</h2>
      <p>Access to SJC OS is limited to authorized users who sign in with their own credentials. We use reasonable administrative and technical measures to protect the information in the system. No method of storage or transmission is completely secure, so we cannot guarantee absolute security.</p>

      <h2>8. Intuit&rsquo;s role</h2>
      <p>Intuit operates QuickBooks Online. How Intuit handles your data is described in <a href="https://www.intuit.com/privacy/">Intuit&rsquo;s privacy statement</a>.</p>

      <h2>9. Children</h2>
      <p>SJC OS is a business system and is not directed to children under 18.</p>

      <h2>10. Changes to this policy</h2>
      <p>We may update this policy from time to time. The effective date at the top shows when it was last changed.</p>

      <h2>11. Contact us</h2>
      <p>SJ Carpentry LLC<br />Circle Pines, Minnesota<br />Phone: (612) 361-6585<br />Website: <a href="https://www.sjcarpentryllc.com">https://www.sjcarpentryllc.com</a></p>
    </LegalPage>
  );
}
