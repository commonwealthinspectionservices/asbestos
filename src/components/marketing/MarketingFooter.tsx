export default function MarketingFooter() {
  return (
    <footer className="border-t-4 border-brand-700 bg-brand-50 px-4 py-2 text-sm text-brand-700">
      <div className="mx-auto max-w-4xl">
        <p className="whitespace-nowrap text-left text-[11px] text-brand-700 sm:text-sm">
          © {new Date().getFullYear()} Commonwealth Inspection Services, LLC — All rights reserved.
        </p>
      </div>
    </footer>
  );
}
