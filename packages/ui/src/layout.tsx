import type React from "react";

export function Card(props: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={props.className ?? "card"}>
      {props.title ? <div className="card-title">{props.title}</div> : null}
      {props.children}
    </section>
  );
}
