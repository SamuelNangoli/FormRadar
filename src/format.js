export const isoDay = (offset = 0) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
export const dayLabel = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "Date TBC";
export const kickOff = (value) =>
  value
    ? new Date(value).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "TBC";
export const localDate = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "Date TBC";
export const statusLabel = (status) =>
  ({
    IN_PLAY: "In play",
    PAUSED: "Half-time",
    FINISHED: "Full time",
    SCHEDULED: "Time TBC",
    TIMED: "Kickoff",
    POSTPONED: "Postponed",
    SUSPENDED: "Suspended",
    CANCELED: "Cancelled",
    CANCELLED: "Cancelled",
    AWARDED: "Awarded",
  })[status] ||
  status ||
  "TBC";
export const hasScore = (match) =>
  Number.isInteger(match.score?.home) && Number.isInteger(match.score?.away);
export const isLive = (match) => ["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT"].includes(match.status);
export const scoreDetail = (match) => {
  if (match.score?.duration === "PENALTY_SHOOTOUT") {
    const penalties = match.score.penalties;
    return Number.isInteger(penalties?.home) &&
      Number.isInteger(penalties?.away)
      ? `Pens ${penalties.home} – ${penalties.away}`
      : "Penalty shootout";
  }
  return match.score?.duration === "EXTRA_TIME" ? "Extra time" : null;
};
