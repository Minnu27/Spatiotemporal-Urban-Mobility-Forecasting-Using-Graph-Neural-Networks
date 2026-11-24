// Recurring public holidays in New York General Construction Law §24.
export function isNewYorkHoliday(year: number, month: number, day: number) {
  const fixedDays = [[1, 1], [2, 12], [6, 19], [7, 4], [11, 11], [12, 25]];
  const date = Date.UTC(year, month - 1, day);
  const weekday = new Date(date).getUTCDay();
  if (fixedDays.some(([m, d]) => {
    const holiday = Date.UTC(year, m - 1, d);
    return date === holiday || (new Date(holiday).getUTCDay() === 0 && date === holiday + 86400_000);
  })) return true;
  if (weekday === 1) {
    return ([1, 2].includes(month) && day >= 15 && day <= 21) ||
      (month === 5 && day >= 25) ||
      (month === 9 && day <= 7) ||
      (month === 10 && day >= 8 && day <= 14);
  }
  return (weekday === 0 && month === 6 && day >= 8 && day <= 14) ||
    (weekday === 2 && month === 11 && day >= 2 && day <= 8) ||
    (weekday === 4 && month === 11 && day >= 22 && day <= 28);
}
