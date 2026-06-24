const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAPLE_LEGENDS_SCREENSHOT = /^MapleLegends (\d{2})-(\d{2})-(\d{4}) (\d{2})-(\d{2})-(\d{2})\.png$/;

export function formatScreenshotFileLabel(fileName: string): string {
  const match = MAPLE_LEGENDS_SCREENSHOT.exec(fileName);
  if (!match) return fileName;

  const [, dayText, monthText, yearText, hourText, minuteText, secondText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (day < 1 || day > 31 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return fileName;
  }

  return `${dayText} ${MONTHS[month - 1]} ${yearText} · ${hourText}:${minuteText}:${secondText}`;
}
