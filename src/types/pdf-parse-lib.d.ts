// @types/pdf-parse only declares the package root ("pdf-parse"); we import
// the implementation file directly to dodge a debug-only block in the
// root index.js that breaks the production build under webpack (see the
// comment at the import site in the documents API route for why).
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse from "pdf-parse";
  export default pdfParse;
}
