import React from "react";
import { Box, Text } from "ink";
import { plainText } from "./markdown.js";

export interface MeetingPane {
  speaker: string;
  sessionId?: string;
  status: "starting" | "running" | "completed" | "failed";
  activity: string;
  messages: string[];
  scroll: number;
}

export function meetingLines(messages: readonly string[], width: number): string[] {
  return messages.flatMap(message => [...plainText(message).split(/\r?\n/).flatMap(line => {
    if (!line) return [""];
    const result: string[] = [];
    let rest = line;
    while (rest.length > width) {
      const space = rest.lastIndexOf(" ", width);
      const split = space > 0 ? space : width;
      result.push(rest.slice(0, split));
      rest = rest.slice(split).trimStart();
    }
    return [...result, rest];
  }), ""]);
}

/** A bounded live viewport for each session; full histories remain in memory and recordings. */
export function MeetingPanes({ panes, selected, width, rows }: { panes: MeetingPane[]; selected: number; width: number; rows: number }): React.JSX.Element {
  const paneWidth = Math.max(4, Math.floor((width - 3) / 2));
  const bodyRows = Math.max(1, rows - 4);
  return <Box flexDirection="column">
    <Box flexDirection="row">
      {panes.map((pane, index) => {
        const lines = meetingLines(pane.messages, paneWidth);
        const end = Math.max(bodyRows, lines.length - Math.min(pane.scroll, Math.max(0, lines.length - bodyRows)));
        const visible = lines.slice(Math.max(0, end - bodyRows), end);
        return <React.Fragment key={pane.speaker}>
          {index > 0 && <Box width={3} flexDirection="column">{Array.from({ length: rows }, (_, row) => <Text key={row} dimColor> | </Text>)}</Box>}
          <Box width={paneWidth} flexDirection="column">
            <Text bold color={index === selected ? "#ffd166" : "#9aa0a6"} wrap="truncate">{index === selected ? "> " : "  "}{pane.speaker} · {pane.status}</Text>
            <Text dimColor wrap="truncate">Session: {pane.sessionId ?? "starting"}</Text>
            <Text dimColor wrap="truncate">{pane.activity}</Text>
            {Array.from({ length: bodyRows }, (_, row) => <Text key={row} wrap="truncate">{visible[row] || " "}</Text>)}
            <Text dimColor wrap="truncate">{pane.scroll ? "Viewing earlier messages" : "Latest messages"}</Text>
          </Box>
        </React.Fragment>;
      })}
    </Box>
    <Text dimColor wrap="truncate">Tab: select pane · PgUp/PgDn: scroll · /sidebyside close: leave</Text>
  </Box>;
}
