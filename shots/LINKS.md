npm notice run cookie-jar@0.1.0 npx
npm notice run 'tsx' scripts/make-shot-links.ts
# Screenshot routes

Base: http://localhost:4173

## pay-fixed-cook

http://localhost:4173/#/pay/eyJ2IjoxLCJ0byI6IjRHR2s0dlREZDFGQ0E0TkhkNjJ4Y3djYWI4NktBbTZkRnRHN3pyR0tTR1V4IiwibCI6IkJha2VyeSBUYWIiLCJuIjoiT25lIGRvemVuIHNvdXJkb3VnaCwgRnJpZGF5IGNvbGxlY3Rpb24iLCJhIjoiMjc1MDAwIiwiciI6IklOVi0yMDI2LTAxNCJ9

## pay-usd

http://localhost:4173/#/pay/eyJ2IjoxLCJ0byI6ImNvb2tpZS5jb29rIiwibCI6IkxvZ28gYW5kIHdvcmRtYXJrIiwibiI6IlNlY29uZCByZXZpc2lvbiwgZmluYWwgZmlsZXMiLCJ1IjoiMjUuMDAiLCJyIjoiREVTLTAwMzEifQ

## pay-tipjar

http://localhost:4173/#/pay/eyJ2IjoxLCJ0byI6ImNvb2tpZS5jb29rIiwibCI6IlRpcCBqYXIgZm9yIHRoZSBiYWtlciIsIm4iOiJUaGFua3MgZm9yIHRoZSBicmVhZCJ9

## pay-cook-name

http://localhost:4173/#/pay/eyJ2IjoxLCJ0byI6ImNoZWYuY29vayIsImwiOiJLaXRjaGVuIGZ1bmQiLCJhIjoiNTAwMDAifQ

## jar

http://localhost:4173/#/jar/cookie.cook

## create

http://localhost:4173/#/

## about

http://localhost:4173/#/about


## Notes

`chef.cook` is registered but listed for sale on the `.cook` marketplace, so its registry record points at the marketplace escrow. `pay-escrowed-*.png` is that case: the recipient is refused rather than resolved, and the payment is blocked. Chain state can change, so this link may resolve normally in future.

`create-filled-*.png` was rendered with the form's initial state temporarily set to a worked example, because `chrome-headless-shell` cannot type into a page. That change was reverted; it is not in the source.
