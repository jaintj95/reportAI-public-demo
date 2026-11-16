/* Relay demo settings. Edit the values between the quotes; keep the commas.
   The reply is shown for any question this demo has no recording for. */
window.RELAY_DEMO_CONFIG = {
  // Your full name; it replaces {name} in the reply.
  name: "Tejas Jain",
  // Replaces {firstName}; leave "" to use the first word of name.
  firstName: "",
  // Your LinkedIn profile URL (https://...); leave "" to show the label below as plain text, without a link.
  linkedinUrl: "",
  // The text that replaces {linkedin} (a link when linkedinUrl is set).
  linkedinLabel: "LinkedIn",
  // The reply. {name}, {firstName} and {linkedin} are filled in, [text](https://...) or [text](mailto:...) becomes a
  // link, a blank line (\n\n) starts a new paragraph, and everything else is shown exactly as written.
  unmatchedReply: "Thank you! This question can't be answered here because this is a mock version of the real product, built by {name}. If you'd like to try the production version, reach out to {firstName} on {linkedin}.",
  // true shows recorded sample questions as buttons under the reply; false hides them.
  showSampleQuestions: true
};
