/** Wording of the "new FTP" offer on the finish screen. */
export function ftpPromptText({ ftp, delta, basis, source }) {
  const sign = delta < 0 ? "−" : "+";
  const detail = source === "test" ? "Measured by the ramp test." : basis === "twenty" ? "From your best 20 minutes." : "From your best efforts of the last 90 days.";
  return { title: `New FTP detected: ${ftp} W (${sign}${Math.abs(delta)})`, detail };
}
