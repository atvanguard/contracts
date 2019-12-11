npm run truffle:compile
npm run truffle:migrate -- --reset --to 3 --network development
npm run truffle:migrate -- --reset -f 4 --to 4 --network matic_dev
npm run truffle:migrate -- -f 5 --to 5 --network development
mv contractAddresses.json ../output/addresses.plasma.json
