# Relay: clickable demo

Relay is a chat assistant for construction project data. People ask questions in plain
English about budgets, invoices, change orders, contracts and project documents. Relay
answers from the project management system's reporting warehouse and from the project's
own files, and every answer shows where it came from: the SQL behind each table, and
checked quotations from documents with a preview of the cited page, paragraph or cells.

This is a static copy of the real app's interface. **Every answer is a recording.** The
answers were recorded from the real Relay app working on a sample e-Builder account with
three synthetic projects (Relay Demo - Library HVAC, Relay Demo - Science Lab and Relay
Demo - Parking Drainage). Nothing here connects to e-Builder, a database or an AI model.
The page plays the recordings back in real time, progress steps included: each answer
takes as long as it took in the real app, and shows the AI cost and time it recorded.

## Try it

- Pick a question on the welcome screen, or open the sidebar (top-left button) for all
  of them, then press Enter.
- Open the step above an answer to see the exact SQL. Use **Show chart** for charts.
- Expand a source under a document answer and choose **Preview source** to see the cited
  text highlighted, or the original PDF page.
- Some questions have a recorded follow-up: when the answer finishes, it appears in the
  chat box, ready to send. A question without a recording gets a short reply, with recorded
  questions to try.
- Thumbs up or down opens the real feedback form; anything entered stays in your browser tab.
- The chat survives a page reload in the same tab; **New chat** clears it.

## Change the reply to other questions

Edit `demo-config.js` in a text editor: your name, an optional LinkedIn URL and the reply's wording
(`{name}`, `{firstName}` and `{linkedin}` are filled in). The page reads it directly, so it also works from disk.

## Open it locally

Open `index.html` in a browser, or serve this folder, for example with
`python3 -m http.server`, and visit `http://localhost:8000/`.

## Credits

Interface markup and styles come from the app, which is built with Gradio. Fonts are Inter
and JetBrains Mono; charts use plotly.js. See [LICENSES.md](LICENSES.md).
