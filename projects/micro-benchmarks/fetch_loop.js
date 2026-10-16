async function main() {
    let promises = [];
    for (let i = 1; i <= 3; i++) {
        const p = fetch('https://jsonplaceholder.typicode.com/todos/1'); // return promise
        promises.push(p);
    }
    
    for (let i = 0; i < 3; i++) {
        const res = await promises[i];
        const data = await res.json(); // return promise
        console.log(data);
    }
} // return promise

main();