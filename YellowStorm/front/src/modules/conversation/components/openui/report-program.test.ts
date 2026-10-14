import { describe, expect, it } from 'vitest';
import { splitReportProgram } from './report-program';

const chat = 'root = Card([t])\nt = TextContent("Short answer [1].")';
const report = 'root = Report({title: "Q3", subtitle: "Spike"}, [p1])\np1 = Page("p1", cp)\ncp = ContentPage([h])\nh = InlineHeader("Highlights")';

describe('splitReportProgram', () => {
  it('splits presentation programs and holds back their partial streaming root', () => {
    const slides = 'root = Presentation({title: "Japan"}, [s1])\ns1 = Slide("s1", MinimalTitle("Japan"))';
    expect(splitReportProgram(`${chat}\n\n${slides}`)).toEqual({ chat, report: slides });
    expect(splitReportProgram(slides)).toEqual({ chat: '', report: slides });
    expect(splitReportProgram(`${chat}\nroot = Pres`)).toEqual({ chat, report: null });
  });
  it('leaves a chat-only answer untouched', () => {
    expect(splitReportProgram(chat)).toEqual({ chat, report: null });
  });

  it('cuts the report off at its root line, whatever the chat program defined before it', () => {
    expect(splitReportProgram(`${chat}\n\n${report}`)).toEqual({ chat, report });
  });

  it('returns an empty chat part for a report-only answer', () => {
    expect(splitReportProgram(report)).toEqual({ chat: '', report });
  });

  it('follows the report while it streams', () => {
    expect(splitReportProgram(`${chat}\nroot = Rep`).report).toBeNull();
    expect(splitReportProgram(`${chat}\nroot = Report({title: "Q`).report).toBe('root = Report({title: "Q');
  });

  it('does not mistake text that merely mentions Report for the root', () => {
    const prose = 'root = Card([t])\nt = TextContent("Write root = Report( to get a report")';
    expect(splitReportProgram(prose).report).toBeNull();
  });
});
