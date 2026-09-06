import express from "express";
import type { Machine } from "./types.js";
import { AutoScalingClient, SetDesiredCapacityCommand, DescribeAutoScalingInstancesCommand, TerminateInstanceInAutoScalingGroupCommand } from "@aws-sdk/client-auto-scaling";
import { DescribeInstancesCommand, EC2Client } from "@aws-sdk/client-ec2";

const app = express();
app.use(express.json());

const client = new AutoScalingClient({
    region: "us-east-1", credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY!,
        secretAccessKey: process.env.AWS_SECRET_KEY!,
    }
});

const ec2Client = new EC2Client({
    region: "us-east-1", credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY!,
        secretAccessKey: process.env.AWS_SECRET_KEY!,
    }
})

const ALL_MACHINES: Machine[] = [];

async function refereshInstance() {
    const command = new DescribeAutoScalingInstancesCommand();
    const data = await client.send(command);
    console.log("Printing Instances Below")

    const instanceIds = data.AutoScalingInstances
        ? data.AutoScalingInstances.flatMap(x => x.InstanceId ? [x.InstanceId] : [])
        : undefined;

    const ec2InstanceCommand = new DescribeInstancesCommand({ InstanceIds: instanceIds })

    const ec2Response = await ec2Client.send(ec2InstanceCommand);
    const Instances = ec2Response.Reservations?.map(item => item.Instances);
    const filteredMachines = Instances?.flat().filter(x =>
        x && x.State && x.State.Name === "running");

    filteredMachines?.forEach(machine => {
        if (!machine) return;
        const ip = machine.PublicIpAddress;
        const machineName = machine.InstanceId;

        if (ip) {
            // 1. Add machine if it doesn't exist
            if (!ALL_MACHINES.some(m => m.ip === ip)) {
                ALL_MACHINES.push({
                    ip: ip,
                    isUsed: false,
                    instanceId: machineName
                });
            }

            // 2. Mark as used if it belongs to a project
            const existingMachine = ALL_MACHINES.find(m => m.ip === ip);
            if (existingMachine && existingMachine.assignedProject) {
                existingMachine.isUsed = true;
            }
        }
    });

}

refereshInstance();

setInterval(() => {
    refereshInstance();
}, 10 * 1000);

app.get("/:projectId", async (req, res) => {
    const idleMachine = ALL_MACHINES.find(x => x.isUsed === false);
    if (!idleMachine) {
        // scale up the infrasturcture
        res.status(404).send("No idle machine found");
        return;
    }

    // idle machine found
    idleMachine.isUsed = true; // mark it as used
    idleMachine.assignedProject = req.params.projectId; // assign project id

    // scale up the infrasturcture

    const command = new SetDesiredCapacityCommand({
        AutoScalingGroupName: "vscode-asg",
        DesiredCapacity: ALL_MACHINES.length + (5 - ALL_MACHINES.filter(x => x.isUsed === false).length)
    })

    client.send(command);

    res.send({
        ip: idleMachine.ip
    });
});

app.post("/destroy", (req, res) => {
    const { machineId }: { machineId: string } = req.body;

    const command = new TerminateInstanceInAutoScalingGroupCommand({
        InstanceId: machineId,
        // decrease the desired capacity after killing the machine
        // ortherwise aws ASG will start the machine again 

        ShouldDecrementDesiredCapacity: true
    })

    client.send(command);
})



app.listen(process.env.PORT, () => {
    console.log("Server is running on port 3000");
});
