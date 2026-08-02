export default function MarketingFooter() {
  return (
    <footer className="border-t-4 border-brand-700 bg-brand-50 px-4 py-6 text-center text-sm text-brand-700">
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span className="font-semibold text-brand-700">Commonwealth Inspection Services, LLC</span>
        <span>·</span>
        <a href="tel:617-390-4778" className="text-brand-700 hover:text-brand-600">617-390-4778</a>
        <span>·</span>
        <a href="mailto:maasbestos@gmail.com" className="text-brand-700 hover:text-brand-600">maasbestos@gmail.com</a>
        <span>·</span>
        <span className="text-xs text-brand-700">
          © {new Date().getFullYear()} Commonwealth Inspection Services, LLC — All rights reserved.
        </span>
      </p>
    </footer>
  );
}
