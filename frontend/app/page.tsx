import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 24px" }}>
      <h1>theke</h1>
      <p>
        AI copilot for Greek construction permits and compliance. Ask a
        question and get an answer with citations from ΦΕΚ, Law 4495/17, ΤΕΕ,
        and ΥΠΕΝ.
      </p>
      <Link href="/chat">Open chat &rarr;</Link>
    </main>
  );
}
