import { cn } from "@/lib/cn";

/**
 * The ONE page width. Every hub page renders inside <PageContainer>; no
 * page sets its own max-width, mx-auto or side gutter.
 *
 *   gutter  16px phones · 40px from sm up (outside the content box)
 *   width   max-w-page → --page-max (1440px), centred
 *   rhythm  pt-7 top · pb-16 bottom
 *
 * The shell header and footer use <PageWidth> — the same gutter + width
 * without the vertical rhythm — so page edges line up with the header's.
 * Long paragraphs cap themselves at a readable measure (max-w-[70ch]);
 * tables, boards, grids and cards use the full container width.
 */
export function PageWidth({ as: Tag = "div", className, innerClassName, children, ...rest }) {
  return (
    <Tag className={cn("px-4 sm:px-10", className)} {...rest}>
      <div className={cn("mx-auto w-full max-w-page", innerClassName)}>{children}</div>
    </Tag>
  );
}

export function PageContainer({ as = "main", className, innerClassName, children, ...rest }) {
  return (
    <PageWidth
      as={as}
      data-page-container=""
      className={cn("relative z-[2] pb-16 pt-7", className)}
      innerClassName={innerClassName}
      {...rest}
    >
      {children}
    </PageWidth>
  );
}
