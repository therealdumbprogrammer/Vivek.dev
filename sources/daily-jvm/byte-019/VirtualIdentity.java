public class VirtualIdentity {
    static final ThreadLocal<String> REQUEST =
        new ThreadLocal<>();

    public static void main(String[] args)
            throws InterruptedException {
        Thread worker = Thread.ofVirtual()
            .name("customer-request")
            .start(() -> {
                Thread before = Thread.currentThread();
                REQUEST.set("customer-42");
                try {
                    Thread.sleep(20);
                    System.out.println(
                        before == Thread.currentThread());
                    System.out.println(REQUEST.get());
                    System.out.println(before.getName());
                    System.out.println(before.isVirtual());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    REQUEST.remove();
                }
            });
        worker.join();
    }
}
