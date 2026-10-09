// Benchmark-only fixture. Uses public $, not a second implementation of API.
$.ready(() => {
    $.world.gravity(0, 0);
    $.benchApi = {
        configure(factory) { this.operation = factory(); },
        run(iterations) {
            let checksum = 0;
            const begin = $.time.perfNow();
            for (let i = 0; i < iterations; i++) checksum += this.operation(i);
            const elapsed = $.time.perfNow() - begin;
            if (!Number.isFinite(checksum) || !Number.isFinite(elapsed) || elapsed < 0)
                throw new Error('Invalid benchmark result');
            return { elapsed_ms: elapsed, iterations, checksum };
        },
    };
});
