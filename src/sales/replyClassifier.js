const REPLY_TYPES = [
  "INTERESTED",
  "QUESTION",
  "NOT_INTERESTED",
  "OUT_OF_OFFICE",
  "UNSUBSCRIBE",
  "UNKNOWN"
];

function classifyReply(
  text
) {
  const value =
    String(text || "")
      .trim()
      .toLowerCase();

  if (!value) {
    return {
      type: "UNKNOWN",
      confidence: 0
    };
  }

  if (
    /unsubscribe|remove me|stop emailing|do not contact/i.test(
      value
    )
  ) {
    return {
      type: "UNSUBSCRIBE",
      confidence: 0.98
    };
  }

  if (
    /out of office|ooo|away until|returning on/i.test(
      value
    )
  ) {
    return {
      type: "OUT_OF_OFFICE",
      confidence: 0.98
    };
  }

  if (
    /not interested|no thanks|no thank you|don't need|do not need/i.test(
      value
    )
  ) {
    return {
      type: "NOT_INTERESTED",
      confidence: 0.95
    };
  }

  if (
    /how much|price|pricing|cost|what does it cost|how does it work|tell me more/i.test(
      value
    )
  ) {
    return {
      type: "QUESTION",
      confidence: 0.9
    };
  }

  if (
    /interested|sounds good|yes|sure|let's talk|lets talk|book|call|meeting|available/i.test(
      value
    )
  ) {
    return {
      type: "INTERESTED",
      confidence: 0.85
    };
  }

  return {
    type: "UNKNOWN",
    confidence: 0.4
  };
}

function shouldStopSequence(
  classification
) {
  return [
    "INTERESTED",
    "NOT_INTERESTED",
    "UNSUBSCRIBE"
  ].includes(
    classification.type
  );
}

module.exports = {
  REPLY_TYPES,
  classifyReply,
  shouldStopSequence
};
